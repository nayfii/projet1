/**
 * Video formats of the render worker (CLAUDE.md §4.7: 16:9, 9:16, 1:1) and the video files people can
 * give the Video Editor. Shared by the app, the worker and the tests.
 */
export const VIDEO_FORMATS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
} as const;

export type VideoFormat = keyof typeof VIDEO_FORMATS;
export const FORMAT_KEYS = Object.keys(VIDEO_FORMATS) as VideoFormat[];

export function formatOfSize(width: number, height: number): VideoFormat | null {
  return FORMAT_KEYS.find((f) => VIDEO_FORMATS[f].width === width && VIDEO_FORMATS[f].height === height) ?? null;
}

export type RenderKind = "motion" | "video_edit";

/** Longest video each kind may produce (seconds), as checked again by the database. */
export const MAX_RENDER_SECONDS: Record<RenderKind, number> = { motion: 60, video_edit: 300 };

/** Video credits a render reserves; the same rule as `enqueue_render_job`. */
export const renderCredits = (creditsPerSecond: number, seconds: number, formats: number) => Math.ceil(creditsPerSecond * seconds * formats);

export const VIDEO_TYPES = {
  mp4: { mime: "video/mp4" },
  mov: { mime: "video/quicktime" },
  webm: { mime: "video/webm" },
} as const;
export type VideoExtension = keyof typeof VIDEO_TYPES;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_VIDEOS_PER_RUN = 5;
export const VIDEO_ACCEPT = Object.keys(VIDEO_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export function videoExtensionOf(filename: string): VideoExtension | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return ext in VIDEO_TYPES ? (ext as VideoExtension) : null;
}

/** MP4 and MOV start with an "ftyp" box, WebM with the EBML signature. */
export function videoContentMatches(head: Uint8Array, ext: VideoExtension): boolean {
  if (ext === "webm") return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  return head.length >= 8 && String.fromCharCode(head[4], head[5], head[6], head[7]) === "ftyp";
}

/** What the browser read from a video before sending it (indicative only). */
export type VideoMedia = { duration: number; width: number; height: number };
