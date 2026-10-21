import { spawn } from "node:child_process";
import { chown, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { ChildMessage, JobFile, RenderResult } from "./protocol";

/**
 * Render worker (docs/ARCHITECTURE.md §10). Claims jobs from the database queue, downloads the files a
 * job uses, renders it in a child process that has no credentials and no database access, uploads the
 * MP4s, then reports success or failure. Logs carry ids, codes and timings only — never content.
 */

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const WORKER_ID = `${hostname()}-${process.pid}`;
const POLL_MS = Number(process.env.RENDER_POLL_MS ?? 2000);
const JOB_TIMEOUT_MS = Number(process.env.RENDER_JOB_TIMEOUT_MS ?? 15 * 60 * 1000);
const HEARTBEAT_MS = 10_000;
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const childScript = fileURLToPath(new URL("./render-child.js", import.meta.url));

// The child gets only what rendering needs: no keys, no database address.
const CHILD_ENV_KEYS = ["PATH", "LANG", "TZ", "PUPPETEER_CACHE_DIR", "PRODUCER_HEADLESS_SHELL_PATH", "HYPERFRAMES_BROWSER_PATH", "CAPTION_FONT_FILE", "FFMPEG_PATH", "FFPROBE_PATH"];
// In the container, the worker runs as root only to start each render as another, unprivileged user,
// who cannot read this process's environment (the renderer's browser runs without its own sandbox).
const CHILD_UID = process.env.RENDER_CHILD_UID ? Number(process.env.RENDER_CHILD_UID) : null;
const CHILD_GID = process.env.RENDER_CHILD_GID ? Number(process.env.RENDER_CHILD_GID) : CHILD_UID;
const CHILD_HOME = process.env.RENDER_CHILD_HOME ?? process.env.HOME ?? tmpdir();

const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), worker: WORKER_ID, event, ...data }));

type ClaimedJob = {
  id: string;
  company_id: string;
  conversation_id: string;
  kind: "motion" | "video_edit";
  formats: string[];
  duration_seconds: number;
  input: Record<string, unknown>;
  attempts: number;
  assets: { attachment_id: string; name: string; bucket: string; storage_path: string; kind: string; mime_type: string }[];
};

let stopping = false;
let current: { job: ClaimedJob; kill: () => void } | null = null;

async function claim(): Promise<ClaimedJob | null> {
  const { data, error } = await supabase.rpc("render_claim_job", { p_worker: WORKER_ID });
  if (error) {
    log("claim_failed", { code: error.code });
    return null;
  }
  return (data as ClaimedJob | null) ?? null;
}

async function progress(job: ClaimedJob, value: number, stage: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("render_job_progress", { p_job: job.id, p_worker: WORKER_ID, p_progress: value, p_stage: stage });
  if (error) {
    log("progress_failed", { job: job.id, code: error.code });
    return true;
  }
  return data !== false;
}

async function fail(job: ClaimedJob, code: string, retry: boolean) {
  const { error } = await supabase.rpc("render_job_failed", { p_job: job.id, p_worker: WORKER_ID, p_error: code, p_retry: retry });
  if (error) log("fail_report_failed", { job: job.id, code: error.code });
}

/** Asset file names come from the composition; keep them as plain names inside the job folder. */
const safeName = (name: string) => path.basename(name).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "file";

async function download(job: ClaimedJob, dir: string): Promise<JobFile["files"]> {
  const files: JobFile["files"] = [];
  for (const [i, asset] of job.assets.entries()) {
    const { data, error } = await supabase.storage.from(asset.bucket).download(asset.storage_path);
    if (error || !data) throw Object.assign(new Error("download"), { code: "asset_unavailable", retry: true });
    const local = job.kind === "motion" ? path.join("project", "assets", safeName(asset.name)) : path.join("clips", `${i}${path.extname(asset.storage_path)}`);
    await mkdir(path.dirname(path.join(dir, local)), { recursive: true });
    await writeFile(path.join(dir, local), Buffer.from(await data.arrayBuffer()));
    files.push({ name: asset.name, path: local, kind: asset.kind });
  }
  return files;
}

function runChild(job: ClaimedJob, dir: string): Promise<{ ok: true } | { ok: false; code: string; retry: boolean }> {
  return new Promise((resolve) => {
    const childEnv = { ...Object.fromEntries(CHILD_ENV_KEYS.flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : []))), HOME: CHILD_HOME };
    const identity = CHILD_UID !== null ? { uid: CHILD_UID, gid: CHILD_GID! } : {};
    const child = spawn(process.execPath, [childScript, dir], { env: childEnv, stdio: ["ignore", "pipe", "pipe"], cwd: dir, ...identity });
    let last = { value: 0, stage: "starting" };
    let settled = false;
    let reportedCode: string | null = null;
    const finish = (result: { ok: true } | { ok: false; code: string; retry: boolean }) => {
      if (settled) return;
      settled = true;
      clearInterval(beat);
      clearTimeout(timer);
      current = null;
      resolve(result);
    };
    const kill = () => child.kill("SIGKILL");
    current = { job, kill };
    // Heartbeat with the latest progress; stops the render when it was cancelled.
    const beat = setInterval(async () => {
      if (!(await progress(job, last.value, last.stage))) {
        kill();
        finish({ ok: false, code: "cancelled", retry: false });
      }
    }, HEARTBEAT_MS);
    const timer = setTimeout(() => {
      kill();
      finish({ ok: false, code: "render_timeout", retry: false });
    }, JOB_TIMEOUT_MS);
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        let message: ChildMessage | null = null;
        try {
          message = JSON.parse(line) as ChildMessage;
        } catch {
          continue; // Library output: not ours, not logged (it may describe the composition).
        }
        if (message.type === "progress") last = { value: message.progress, stage: message.stage };
        if (message.type === "error") reportedCode = message.code;
      }
    });
    child.stderr.on("data", () => {
      // Discarded: renderer logs can quote the page being rendered.
    });
    child.on("exit", (code) => {
      if (code === 0) finish({ ok: true });
      else finish({ ok: false, code: reportedCode ?? "render_failed", retry: reportedCode === null });
    });
  });
}

/** Hands the job folder to the render user. */
async function giveTo(dir: string, uid: number, gid: number) {
  await chown(dir, uid, gid);
  for (const entry of await readdir(dir, { recursive: true })) await chown(path.join(dir, entry), uid, gid);
}

async function upload(job: ClaimedJob, dir: string): Promise<{ outputs: unknown[]; seconds: number }> {
  const result = JSON.parse(await readFile(path.join(dir, "result.json"), "utf8")) as RenderResult;
  const outputs = [];
  for (const out of result.outputs) {
    const target = `${job.conversation_id}/${job.id}/${out.format.replace(":", "x")}.mp4`;
    const body = await readFile(path.join(dir, out.file));
    const { error } = await supabase.storage.from("render-outputs").upload(target, body, { contentType: "video/mp4", upsert: true });
    if (error) throw Object.assign(new Error("upload"), { code: "upload_failed", retry: true });
    outputs.push({ format: out.format, path: target, bytes: (await stat(path.join(dir, out.file))).size, width: out.width, height: out.height, seconds: out.seconds });
  }
  return { outputs, seconds: result.seconds };
}

async function handle(job: ClaimedJob) {
  const started = Date.now();
  log("job_started", { job: job.id, kind: job.kind, formats: job.formats, attempt: job.attempts });
  const dir = await mkdtemp(path.join(tmpdir(), "render-"));
  try {
    const files = await download(job, dir);
    const jobFile: JobFile = { kind: job.kind, formats: job.formats, durationSeconds: Number(job.duration_seconds), input: job.input, files };
    await writeFile(path.join(dir, "job.json"), JSON.stringify(jobFile));
    if (CHILD_UID !== null) await giveTo(dir, CHILD_UID, CHILD_GID!);
    await progress(job, 1, "rendering");
    const result = await runChild(job, dir);
    if (!result.ok) {
      log("job_failed", { job: job.id, code: result.code, retry: result.retry, ms: Date.now() - started });
      await fail(job, result.code, result.retry);
      return;
    }
    await progress(job, 99, "uploading");
    const { outputs, seconds } = await upload(job, dir);
    const { error } = await supabase.rpc("render_job_succeeded", { p_job: job.id, p_worker: WORKER_ID, p_outputs: outputs, p_seconds: seconds });
    if (error) throw Object.assign(new Error("report"), { code: "report_failed", retry: true });
    log("job_succeeded", { job: job.id, seconds, outputs: outputs.length, ms: Date.now() - started });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "worker_error";
    log("job_failed", { job: job.id, code, ms: Date.now() - started });
    await fail(job, code, (error as { retry?: boolean }).retry ?? true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  log("worker_started", { pollMs: POLL_MS });
  while (!stopping) {
    const job = await claim();
    if (job) await handle(job);
    else await new Promise((r) => setTimeout(r, POLL_MS));
  }
  log("worker_stopped");
}

// Stopping (deploy, scale down): the running job goes back to the queue for another worker.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    if (current) {
      const { job, kill } = current;
      kill();
      await fail(job, "worker_stopped", true);
    }
    process.exit(0);
  });
}

void main();
