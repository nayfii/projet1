import type { RenderKind, VideoFormat } from "./formats";

/** A render as the conversation shows it (no composition, no plan, no storage path). */
export type RenderJobView = {
  id: string;
  kind: RenderKind;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  stage: string | null;
  formats: VideoFormat[];
  durationSeconds: number;
  outputs: { format: VideoFormat; width: number; height: number; seconds: number; bytes: number }[];
  errorCode: string | null;
  creditsReserved: number;
  creditsCharged: number | null;
  mine: boolean;
  createdAt: string;
};

export const ACTIVE_STATUSES = ["queued", "running"] as const;

export type RenderJobsResponse = {
  jobs: RenderJobView[];
  /** Video credits per second of video, by kind (set by our team). */
  rates: Partial<Record<RenderKind, number>>;
  /** The company's video credits left this month (renders waiting or running are already counted). */
  creditsLeft: number;
  /** The company's video credits for the month (plan + extra credits). */
  creditsLimit: number;
};
