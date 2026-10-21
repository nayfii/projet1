import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import { fontCss, inspectComposition, prepareComposition } from "../../src/modules/render/composition";
import { editPlanSchema, ffmpegArgs, fitPlanToClips, planDuration, wrapCaption, type ProbedClip } from "../../src/modules/render/edit-plan";
import { VIDEO_FORMATS, type VideoFormat } from "../../src/modules/render/formats";
import type { ChildMessage, JobFile, RenderResult } from "./protocol";

/**
 * Renders one job from its folder (job.json + downloaded files) into result.json + MP4 files. Runs in
 * a separate process without credentials. AI-written code (Motion Design) runs only inside the headless
 * browser of the renderer, behind a policy that blocks any request outside the job folder.
 */

const dir = process.argv[2];
const send = (message: ChildMessage) => process.stdout.write(`${JSON.stringify(message)}\n`);
class RenderError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const require = createRequire(import.meta.url);
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
const captionFont = process.env.CAPTION_FONT_FILE ?? "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf";

function run(command: string, args: string[], onStdout?: (line: string) => void): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let rest = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text.length < 1_000_000 ? text : "";
      if (!onStdout) return;
      const lines = (rest + text).split("\n");
      rest = lines.pop() ?? "";
      lines.forEach(onStdout);
    });
    child.stderr.resume();
    child.on("error", () => resolve({ code: -1, stdout }));
    child.on("exit", (code) => resolve({ code: code ?? -1, stdout }));
  });
}

async function probe(file: string): Promise<{ duration: number; width: number; height: number; hasAudio: boolean } | null> {
  const { code, stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  if (code !== 0) return null;
  try {
    const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
    const video = info.streams?.find((s) => s.codec_type === "video");
    const duration = Number(info.format?.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0) return null;
    return { duration, width: video.width ?? 0, height: video.height ?? 0, hasAudio: Boolean(info.streams?.some((s) => s.codec_type === "audio")) };
  } catch {
    return null;
  }
}

const stageOf = (label: string) =>
  /captur/i.test(label) ? "capturing" : /encod/i.test(label) ? "encoding" : /assembl|finaliz|mux/i.test(label) ? "assembling" : "preparing";

async function renderMotion(job: JobFile): Promise<RenderResult> {
  const html = String(job.input.composition ?? "");
  const inspected = inspectComposition(html);
  if (!inspected.ok) throw new RenderError("invalid_composition");
  const project = path.join(dir, "project");
  await mkdir(path.join(project, "fonts"), { recursive: true });
  await copyFile(require.resolve("gsap/dist/gsap.min.js"), path.join(project, "gsap.min.js"));
  const fonts = path.dirname(require.resolve("@fontsource-variable/inter/package.json"));
  await copyFile(path.join(fonts, "files/inter-latin-wght-normal.woff2"), path.join(project, "fonts/inter-latin.woff2"));
  await copyFile(path.join(fonts, "files/inter-latin-ext-wght-normal.woff2"), path.join(project, "fonts/inter-latin-ext.woff2"));
  const available = new Set(job.files.map((f) => f.name));
  const prepared = prepareComposition(html, {
    mode: "render",
    fontCss: fontCss({ latin: "fonts/inter-latin.woff2", latinExt: "fonts/inter-latin-ext.woff2" }),
    assetUrl: (name) => (available.has(name) ? `assets/${path.basename(job.files.find((f) => f.name === name)!.path)}` : null),
  });
  await writeFile(path.join(project, "index.html"), prepared);

  const format = inspected.info.format;
  const output = path.join(dir, "out", `${format.replace(":", "x")}.mp4`);
  const quiet = { info() {}, warn() {}, error() {}, debug() {} };
  const renderJob = createRenderJob({ fps: 30, quality: "standard", format: "mp4", entryFile: "index.html", logger: quiet } as Parameters<typeof createRenderJob>[0]);
  let last = -1;
  await executeRenderJob(renderJob, project, output, (j: { progress: number; currentStage?: string }) => {
    const value = Math.max(1, Math.min(98, Math.round(j.progress)));
    if (value === last) return;
    last = value;
    send({ type: "progress", progress: value, stage: stageOf(j.currentStage ?? "") });
  });
  const info = await probe(output);
  if (!info) throw new RenderError("render_failed");
  const seconds = Math.round(info.duration * 100) / 100;
  return { seconds, outputs: [{ format, file: path.relative(dir, output), width: info.width, height: info.height, seconds }] };
}

async function renderEdit(job: JobFile): Promise<RenderResult> {
  const parsed = editPlanSchema.safeParse(job.input.plan);
  if (!parsed.success) throw new RenderError("invalid_plan");
  const clips: Record<string, ProbedClip> = {};
  for (const file of job.files) {
    const info = await probe(path.join(dir, file.path));
    if (!info) throw new RenderError("clip_unreadable");
    clips[file.name] = { path: path.join(dir, file.path), duration: info.duration, hasAudio: info.hasAudio };
  }
  const plan = fitPlanToClips(parsed.data, clips);
  if (plan.segments.length === 0) throw new RenderError("clip_unreadable");
  const total = planDuration(plan);
  await mkdir(path.join(dir, "out"), { recursive: true });
  const formats = job.formats.filter((f): f is VideoFormat => f in VIDEO_FORMATS);
  const outputs: RenderResult["outputs"] = [];
  for (const [i, format] of formats.entries()) {
    const output = path.join(dir, "out", `${format.replace(":", "x")}.mp4`);
    const captionFiles = await Promise.all(
      plan.captions.map(async (c, k) => {
        const file = path.join(dir, `caption-${format.replace(":", "x")}-${k}.txt`);
        await writeFile(file, wrapCaption(c.text, format));
        return file;
      }),
    );
    let last = -1;
    const { code } = await run(ffmpeg, ffmpegArgs({ plan, clips, format, output, fontFile: captionFont, captionFiles }), (line) => {
      const match = /^out_time_us=(\d+)/.exec(line);
      if (!match) return;
      const done = Math.min(1, Number(match[1]) / 1e6 / total);
      const value = Math.max(1, Math.min(98, Math.round(((i + done) / formats.length) * 100)));
      if (value !== last) {
        last = value;
        send({ type: "progress", progress: value, stage: "encoding" });
      }
    });
    const info = code === 0 ? await probe(output) : null;
    if (!info) throw new RenderError("render_failed");
    outputs.push({ format, file: path.relative(dir, output), width: info.width, height: info.height, seconds: Math.round(info.duration * 100) / 100 });
  }
  return { seconds: Math.max(...outputs.map((o) => o.seconds)), outputs };
}

try {
  const job = JSON.parse(await readFile(path.join(dir, "job.json"), "utf8")) as JobFile;
  send({ type: "progress", progress: 1, stage: "preparing" });
  const result = job.kind === "motion" ? await renderMotion(job) : await renderEdit(job);
  await writeFile(path.join(dir, "result.json"), JSON.stringify(result));
  process.exit(0);
} catch (error) {
  // A known problem (bad composition, unreadable clip) is reported; anything else may be retried.
  if (error instanceof RenderError) send({ type: "error", code: error.code });
  process.exit(1);
}
