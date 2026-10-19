import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";
import { defaultChoice, getCompanyModels, resolveModel } from "@/modules/providers/server/models";
import { getProvider } from "@/modules/providers/server/registry";
import type { ChatUsage } from "@/modules/providers/types";
import { computeCharge } from "@/modules/usage/credits";
import { getMyQuota } from "@/modules/usage/server/quota";
import { recordUsage } from "@/modules/usage/server/record";

export type MemoryTaskError = "quota_exceeded" | "no_model_available" | "provider_error";

/**
 * One background AI request for memory features (suggestions, promotions). Same rules as chat:
 * company-allowed models, quota checked first, real token counts logged as usage ("memory").
 */
export async function runMemoryTask(
  supabase: UserClient,
  ctx: MemberContext,
  task: { system: string; user: string; modelChoice?: string; feature?: "memory" | "handover" },
): Promise<{ ok: true; text: string } | { ok: false; error: MemoryTaskError }> {
  const quota = await getMyQuota(ctx.active.companyId);
  if (!quota || quota.state.state === "blocked") return { ok: false, error: "quota_exceeded" };

  const models = await getCompanyModels(ctx.active.companyId);
  const resolution = resolveModel(task.modelChoice ?? defaultChoice(models), models, {
    text: task.user.slice(0, 2000),
    imageCount: 0,
    attachmentChars: 0,
    historyTokens: Math.ceil(task.user.length / 3.5),
  });
  if (!resolution.ok) return { ok: false, error: "no_model_available" };
  const model = resolution.model;

  const started = Date.now();
  let text = "";
  let usage: ChatUsage | null = null;
  let failed: string | null = null;
  for await (const event of getProvider(model.provider).stream(
    { apiModelId: model.apiModelId, system: task.system, messages: [{ role: "user", content: [{ type: "text", text: task.user }] }], maxOutputTokens: 4000 },
    new AbortController().signal,
  )) {
    if (event.type === "text") text += event.delta;
    else if (event.type === "usage") usage = event.usage;
    else if (event.type === "error") failed = event.error.code;
  }
  const counted = usage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const charge = computeCharge(model.pricing, counted);
  await recordUsage({
    companyId: ctx.active.companyId,
    userId: ctx.user.id,
    feature: task.feature ?? "memory",
    conversationId: null,
    messageId: null,
    provider: model.provider,
    modelId: model.id,
    apiModelId: model.apiModelId,
    autoRouted: Boolean(resolution.routing),
    inputTokens: counted.inputTokens,
    outputTokens: counted.outputTokens,
    cachedInputTokens: counted.cachedInputTokens,
    tokensEstimated: false,
    credits: charge.credits,
    estimatedCostUsd: charge.estimatedCostUsd,
    status: failed ? "error" : "ok",
    errorCode: failed,
    latencyMs: Date.now() - started,
  });
  return failed ? { ok: false, error: "provider_error" } : { ok: true, text };
}

export const SUGGEST_ENTRIES_SYSTEM = [
  "Task: extract memory entries.",
  "You read a conversation from a company's AI workspace and propose durable knowledge worth saving in the company's memory: facts, decisions, preferences, procedures, contacts or deadlines that will still be useful later.",
  "Leave out greetings, questions, drafts, generic advice and anything uncertain.",
  'Return ONLY JSON: an array of at most 5 objects {"title": "short title, max 80 characters", "content": "the fact or decision in 1 to 3 self-contained sentences"}, written in the language of the conversation. Return [] if nothing is worth saving.',
].join("\n");

export const PROMOTE_SYSTEM = [
  "Task: generalise a client note.",
  "You turn a note from ONE client's file into a general learning that can help with OTHER clients.",
  "Remove everything that identifies the client or a person: company, brand and people names, places, client-specific products, amounts, dates, contract details, e-mails and phone numbers.",
  "Keep only the general lesson (for example: \"Clients in retail prefer short weekly reports\").",
  'Return ONLY JSON: {"general": true or false, "title": "short title, max 80 characters", "content": "1 to 3 sentences"}, in the language of the note. Use "general": false when no lesson can be drawn without client-specific information.',
].join("\n");
