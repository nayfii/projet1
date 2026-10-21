import { z } from "zod";
import { FORMAT_KEYS, MAX_RENDER_SECONDS, VIDEO_FORMATS, type VideoFormat } from "./formats";

/**
 * Video Editor (CLAUDE.md §4.7): the model writes an edit plan (cuts, order, captions, formats) as JSON
 * in a fenced block whose language is `editplan`. Our code checks it and builds the FFmpeg commands;
 * the model never writes a command.
 */

export const EDIT_PLAN_LANG = "editplan";
const BLOCK = /```editplan[^\n]*\n([\s\S]*?)```/g;

const seconds = z.number().finite().min(0).max(3600);

/** Length of the edited video (seconds). */
export const planDuration = (plan: { segments: { start: number; end: number }[] }): number =>
  Math.round(plan.segments.reduce((sum, s) => sum + (s.end - s.start), 0) * 100) / 100;

export const editPlanSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    segments: z
      .array(z.object({ clip: z.string().trim().min(1).max(255), start: seconds, end: seconds }).refine((s) => s.end - s.start >= 0.2, "segment too short"))
      .min(1)
      .max(40),
    captions: z
      .array(z.object({ text: z.string().trim().min(1).max(160), start: seconds, end: seconds }).refine((c) => c.end > c.start, "caption ends before it starts"))
      .max(60)
      .default([]),
    formats: z.array(z.enum(FORMAT_KEYS as [VideoFormat, ...VideoFormat[]])).min(1).max(3),
    /** "crop": fill the frame (edges cut); "pad": whole picture with bars. */
    fit: z.enum(["crop", "pad"]).default("crop"),
  })
  .refine((p) => new Set(p.formats).size === p.formats.length, "duplicate format")
  .refine((p) => planDuration(p) <= MAX_RENDER_SECONDS.video_edit, "too long");

export type EditPlan = z.infer<typeof editPlanSchema>;

export function extractEditPlan(markdown: string): { ok: true; plan: EditPlan } | { ok: false; problem: "no_plan" | "invalid_plan" } {
  const blocks = [...markdown.matchAll(BLOCK)];
  const json = blocks.at(-1)?.[1];
  if (!json) return { ok: false, problem: "no_plan" };
  try {
    const parsed = editPlanSchema.safeParse(JSON.parse(json));
    return parsed.success ? { ok: true, plan: parsed.data } : { ok: false, problem: "invalid_plan" };
  } catch {
    return { ok: false, problem: "invalid_plan" };
  }
}

/** Clip names used by the plan, in order of first use. */
export const planClips = (plan: { segments: { clip: string }[] }): string[] => [...new Set(plan.segments.map((s) => s.clip))];

export type ProbedClip = { path: string; duration: number; hasAudio: boolean };

/**
 * The plan cut to the real clips (as the worker measured them): segments clamped to each clip's length,
 * the ones left empty dropped, captions kept inside the final duration.
 */
export function fitPlanToClips(plan: EditPlan, clips: Record<string, ProbedClip>): EditPlan {
  const segments = plan.segments
    .map((s) => {
      const clip = clips[s.clip];
      if (!clip) return null;
      const end = Math.min(s.end, clip.duration);
      return end - s.start >= 0.2 ? { ...s, end } : null;
    })
    .filter((s): s is EditPlan["segments"][number] => s !== null);
  const total = planDuration({ segments });
  const captions = plan.captions.filter((c) => c.start < total).map((c) => ({ ...c, end: Math.min(c.end, total) }));
  return { ...plan, segments, captions };
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Caption text size for a format (pixels). */
export const captionSize = (format: VideoFormat) => Math.round(Math.min(VIDEO_FORMATS[format].width, VIDEO_FORMATS[format].height) * 0.05);

/** A caption split into lines that fit the frame width (FFmpeg does not wrap text by itself). */
export function wrapCaption(text: string, format: VideoFormat): string {
  const max = Math.max(12, Math.floor((VIDEO_FORMATS[format].width * 0.84) / (captionSize(format) * 0.56)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const pieces = word.length > max ? (word.match(new RegExp(`.{1,${max}}`, "g")) ?? [word]) : [word];
    for (const piece of pieces) {
      if (!line) line = piece;
      else if (line.length + 1 + piece.length <= max) line = `${line} ${piece}`;
      else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * FFmpeg arguments for one output format (passed as an argument list, never through a shell). Captions
 * are read from text files (`captionFiles[i]`, written with `wrapCaption` for this format), so their
 * text is never part of the filter graph.
 */
export function ffmpegArgs(input: {
  plan: EditPlan;
  clips: Record<string, ProbedClip>;
  format: VideoFormat;
  output: string;
  fontFile: string;
  captionFiles: string[];
}): string[] {
  const { plan, clips, format } = input;
  const { width: W, height: H } = VIDEO_FORMATS[format];
  const names = planClips(plan);
  const index = new Map(names.map((name, i) => [name, i]));
  const fit =
    plan.fit === "pad"
      ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const filters: string[] = [];
  plan.segments.forEach((s, i) => {
    const k = index.get(s.clip)!;
    const clip = clips[s.clip];
    filters.push(`[${k}:v]trim=start=${n(s.start)}:end=${n(s.end)},setpts=PTS-STARTPTS,${fit},setsar=1,fps=30,format=yuv420p[v${i}]`);
    filters.push(
      clip.hasAudio
        ? `[${k}:a]atrim=start=${n(s.start)}:end=${n(s.end)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${n(s.end - s.start)}[a${i}]`,
    );
  });
  const pairs = plan.segments.map((_, i) => `[v${i}][a${i}]`).join("");
  filters.push(`${pairs}concat=n=${plan.segments.length}:v=1:a=1[vc][ac]`);
  let video = "[vc]";
  const size = captionSize(format);
  plan.captions.forEach((c, i) => {
    const out = `[t${i}]`;
    filters.push(
      `${video}drawtext=fontfile=${input.fontFile}:textfile=${input.captionFiles[i]}:expansion=none:fontsize=${size}:fontcolor=white:` +
        `box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.45)}:line_spacing=${Math.round(size * 0.25)}:` +
        `x=(w-text_w)/2:y=h-text_h-${Math.round(H * 0.09)}:enable='between(t,${n(c.start)},${n(c.end)})'${out}`,
    );
    video = out;
  });
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...names.flatMap((name) => ["-i", clips[name].path]),
    "-filter_complex",
    filters.join(";"),
    "-map",
    video,
    "-map",
    "[ac]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    input.output,
  ];
}
