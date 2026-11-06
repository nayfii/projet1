import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderId } from "@/modules/providers/types";

/**
 * AUDITED service-role module (docs/ARCHITECTURE.md §5). Writes usage rows and "blocked request"
 * activity entries, which users must not be able to forge, and reads the per-feature rates our team
 * sets (platform settings, not readable by customers). Metadata only: never prompt or answer text.
 */

export type UsageEvent = {
  companyId: string;
  userId: string;
  feature: "chat" | "memory" | "embedding" | "handover" | "confronter" | "agent" | "avatar" | "client_summary" | "dictation" | "title" | "image";
  conversationId: string | null;
  messageId: string | null;
  provider: ProviderId;
  modelId: string;
  apiModelId: string;
  autoRouted: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  tokensEstimated: boolean;
  credits: number;
  estimatedCostUsd: number;
  status: "ok" | "error" | "aborted";
  errorCode: string | null;
  latencyMs: number;
  /** Web searches the model ran for this answer (charged at our team's rate, included in `credits`). */
  webSearches?: number;
};

export async function recordUsage(event: UsageEvent): Promise<void> {
  const { error } = await createAdminClient().from("usage_events").insert({
    company_id: event.companyId,
    user_id: event.userId,
    feature: event.feature,
    conversation_id: event.conversationId,
    message_id: event.messageId,
    provider: event.provider,
    model_id: event.modelId,
    api_model_id: event.apiModelId,
    auto_routed: event.autoRouted,
    input_tokens: Math.round(event.inputTokens),
    output_tokens: Math.round(event.outputTokens),
    cached_input_tokens: Math.round(event.cachedInputTokens),
    tokens_estimated: event.tokensEstimated,
    credits: event.credits,
    estimated_cost_usd: event.estimatedCostUsd,
    status: event.status,
    error_code: event.errorCode,
    latency_ms: event.latencyMs,
    web_searches: event.webSearches ?? 0,
  });
  // Never silently lose usage: it is what quotas and billing rely on. Log metadata only.
  if (error) console.error("usage_events insert failed", { code: error.code, companyId: event.companyId });
}

export type BlockedReason = "quota_user" | "quota_company" | "model_not_allowed" | "auto_disabled" | "quota_video";

/** Activity log entry for a request refused before reaching any AI provider. */
export async function logBlockedRequest(companyId: string, userId: string, reason: BlockedReason): Promise<void> {
  const { error } = await createAdminClient().from("audit_log").insert({
    scope: "company",
    company_id: companyId,
    actor_id: userId,
    action: "ai.request_blocked",
    target_type: "user",
    target_id: userId,
    metadata: { reason },
  });
  if (error) console.error("audit_log insert failed", { code: error.code, companyId });
}

/** Voice dictation rate set by our team (platform_settings): credits and estimated provider cost per minute. */
export async function dictationRate(): Promise<{ creditsPerMinute: number; costUsdPerMinute: number }> {
  const { data } = await createAdminClient()
    .from("platform_settings")
    .select("dictation_credits_per_minute, dictation_cost_usd_per_minute")
    .single();
  return { creditsPerMinute: Number(data?.dictation_credits_per_minute ?? 0), costUsdPerMinute: Number(data?.dictation_cost_usd_per_minute ?? 0) };
}

/** Web search rate set by our team (platform_settings): credits and estimated provider cost per search. */
export async function webSearchRate(): Promise<{ credits: number; costUsd: number }> {
  const { data } = await createAdminClient().from("platform_settings").select("web_search_credits, web_search_cost_usd").single();
  return { credits: Number(data?.web_search_credits ?? 0), costUsd: Number(data?.web_search_cost_usd ?? 0) };
}

/** Credits and estimated cost of one image made in the chat (set by our team in the console). */
export async function imageRate(): Promise<{ credits: number; costUsd: number }> {
  const { data } = await createAdminClient().from("platform_settings").select("image_credits, image_cost_usd").single();
  return { credits: Number(data?.image_credits ?? 0), costUsd: Number(data?.image_cost_usd ?? 0) };
}
