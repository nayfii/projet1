import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderId } from "@/modules/providers/types";

/**
 * AUDITED service-role module (docs/ARCHITECTURE.md §5). Writes usage rows and "blocked request"
 * activity entries, which users must not be able to forge. Metadata only: never prompt or answer text.
 */

export type UsageEvent = {
  companyId: string;
  userId: string;
  feature: "chat";
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
  });
  // Never silently lose usage: it is what quotas and billing rely on. Log metadata only.
  if (error) console.error("usage_events insert failed", { code: error.code, companyId: event.companyId });
}

export type BlockedReason = "quota_user" | "quota_company" | "model_not_allowed" | "auto_disabled";

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
