import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { getMyQuota } from "@/modules/usage/server/quota";
import { dictationRate, logBlockedRequest, recordUsage } from "@/modules/usage/server/record";
import { DICTATION_CONTEXT_CHARS, DICTATION_MAX_BYTES, DICTATION_MAX_SECONDS, dictationCredits, sniffAudioType, type DictationError } from "@/modules/dictation/files";
import { transcribeSpeech } from "@/modules/dictation/server/transcribe";

export const maxDuration = 120;

function fail(error: DictationError, status: number) {
  return Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Voice dictation (CLAUDE.md §11): a short recording → its text, returned to the person's message box,
 * where they read it before sending (Hide masks it then, like anything typed). Neither the audio nor
 * the text is stored or logged; usage records the duration and credits only.
 */
export async function POST(request: Request) {
  const member = await memberOrNull();
  if (!member) return fail("forbidden", 403);
  const userId = member.user.id;
  const companyId = member.active.companyId;

  const supabase = await createClient();
  const { data: settings } = await supabase.from("company_ai_settings").select("dictation_enabled").eq("company_id", companyId).maybeSingle();
  if (settings && !settings.dictation_enabled) return fail("disabled", 403);

  if (Number(request.headers.get("content-length") ?? 0) > DICTATION_MAX_BYTES + 64 * 1024) return fail("too_large", 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) return fail("invalid_audio", 400);
  if (file.size > DICTATION_MAX_BYTES) return fail("too_large", 413);
  // The browser's own measure of the recording, used for credits when the model does not report one.
  const clientSeconds = Math.max(0, Number(form?.get("seconds") ?? 0)) || 0;
  if (clientSeconds > DICTATION_MAX_SECONDS + 5) return fail("too_long", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffAudioType(bytes)) return fail("invalid_audio", 400);
  const locale = form?.get("locale") === "en" ? "en" : "fr";
  // The end of what this same recording already said (its previous parts), as a hint for continuity.
  const context = form?.get("context");
  const previous = typeof context === "string" ? context.slice(-DICTATION_CONTEXT_CHARS) : null;

  const quota = await getMyQuota(companyId);
  if (quota?.state.state === "blocked") {
    await logBlockedRequest(companyId, userId, quota.state.scope === "user" ? "quota_user" : "quota_company");
    return fail("quota", 402);
  }

  const rate = await dictationRate();
  const started = Date.now();
  const usage = { companyId, userId, feature: "dictation" as const, conversationId: null, messageId: null, provider: "openai" as const, autoRouted: false, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, tokensEstimated: false };
  let result: Awaited<ReturnType<typeof transcribeSpeech>>;
  try {
    result = await transcribeSpeech(bytes, locale, previous);
  } catch (error) {
    const code = error instanceof Error && error.name ? error.name : "unknown";
    await recordUsage({ ...usage, modelId: "dictation", apiModelId: "dictation", credits: 0, estimatedCostUsd: 0, status: "error", errorCode: code.slice(0, 60), latencyMs: Date.now() - started });
    return fail("failed", 502);
  }
  if (result === "not_configured") return fail("not_configured", 503);

  const seconds = Math.min(result.seconds ?? clientSeconds, DICTATION_MAX_SECONDS);
  await recordUsage({
    ...usage,
    modelId: result.model,
    apiModelId: result.model,
    credits: dictationCredits(seconds, rate.creditsPerMinute),
    estimatedCostUsd: result.test ? 0 : (Math.max(seconds, 1) / 60) * rate.costUsdPerMinute,
    status: "ok",
    errorCode: null,
    latencyMs: Date.now() - started,
  });
  if (!result.text) return fail("empty", 422);
  return Response.json({ ok: true, text: result.text, test: result.test }, { headers: { "Cache-Control": "no-store" } });
}
