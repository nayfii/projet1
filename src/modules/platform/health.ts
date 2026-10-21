import type { ProviderId } from "@/modules/providers/types";

/** One provider over the last 24 hours, from platform_provider_health (metadata only). */
export type ProviderTraffic = {
  provider: ProviderId;
  requests: number;
  errors: number;
  /** Errors that say something about the provider (refused or too-long requests excluded). */
  service_errors: number;
  top_error: string | null;
  avg_latency_ms: number | null;
  last_ok_at: string | null;
  last_error_at: string | null;
  errors_last_hour: number;
  ok_last_hour: number;
};

export type ProviderTest = { ok: boolean; code: string | null; latencyMs: number | null; at: string };

export type HealthStatus = "not_configured" | "no_traffic" | "operational" | "degraded" | "down";

/** Above this share of failed requests over 24 hours, a provider is shown as disturbed. */
export const DEGRADED_ERROR_RATE = 0.05;

const after = (a: string | null | undefined, b: string | null | undefined) => Boolean(a) && (!b || a! > b);

/**
 * Status shown on the provider health page. The most recent signal wins: a live test newer than the
 * last real request says more than the traffic before it.
 */
export function classifyProvider(configured: boolean, traffic: ProviderTraffic | undefined, test: ProviderTest | undefined): HealthStatus {
  if (!configured) return "not_configured";
  const lastRequest = [traffic?.last_ok_at, traffic?.last_error_at].filter(Boolean).sort().at(-1) ?? null;
  if (test && after(test.at, lastRequest)) {
    if (!test.ok) return "down";
    if (!traffic || traffic.requests === 0) return "operational";
  }
  if (!traffic || traffic.requests === 0) return "no_traffic";
  if (traffic.errors_last_hour > 0 && traffic.ok_last_hour === 0 && !after(test?.ok ? test.at : null, traffic.last_error_at)) return "down";
  if (traffic.errors_last_hour > 0 || traffic.service_errors / traffic.requests > DEGRADED_ERROR_RATE) return "degraded";
  return "operational";
}

export type RenderQueue = {
  queued: number;
  running: number;
  oldest_queued_at: string | null;
  last_heartbeat_at: string | null;
  succeeded: number;
  failed: number;
  last_succeeded_at: string | null;
};

export type RenderStatus = "idle" | "working" | "stuck";

/** A video waiting more than this long with nothing rendering means the worker is probably stopped. */
export const RENDER_STUCK_MS = 3 * 60_000;

export function classifyRenderQueue(queue: RenderQueue, now = Date.now()): RenderStatus {
  if (queue.running > 0) {
    // The worker sends a heartbeat while it renders; silence for a few minutes means it died mid-job.
    const beat = queue.last_heartbeat_at ? new Date(queue.last_heartbeat_at).getTime() : 0;
    return now - beat > RENDER_STUCK_MS ? "stuck" : "working";
  }
  if (queue.queued > 0 && queue.oldest_queued_at && now - new Date(queue.oldest_queued_at).getTime() > RENDER_STUCK_MS) return "stuck";
  return queue.queued > 0 ? "working" : "idle";
}
