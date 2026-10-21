/** What the worker hands to the render child (job.json) and what the child gives back. */
export type JobFile = {
  kind: "motion" | "video_edit";
  formats: string[];
  durationSeconds: number;
  input: Record<string, unknown>;
  /** Downloaded attachments: their name in the composition or plan, and their path in the job folder. */
  files: { name: string; path: string; kind: string }[];
};

export type RenderResult = {
  /** Seconds of video produced (one output's length). */
  seconds: number;
  outputs: { format: string; file: string; width: number; height: number; seconds: number }[];
};

/** One JSON line per message on the child's standard output. */
export type ChildMessage = { type: "progress"; progress: number; stage: string } | { type: "error"; code: string };
