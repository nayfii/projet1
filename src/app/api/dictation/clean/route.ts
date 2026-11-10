import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { fakeProviderEnabled } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { runMemoryTask } from "@/modules/memory/server/ai-tasks";
import { getCompanyModels } from "@/modules/providers/server/models";
import { acceptCleanup, CLEANUP_AI_MAX_CHARS, CLEANUP_AI_MIN_WORDS, CLEANUP_MAX_CHARS, cleanupRequest, cleanupSystem, tidyDictation } from "@/modules/dictation/cleanup";

export const maxDuration = 60;

const Body = z.object({ text: z.string().max(CLEANUP_MAX_CHARS), locale: z.enum(["fr", "en"]).default("fr") });

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Dictated text made ready to read (hesitations, punctuation, the speaker's own corrections), before
 * it lands in the message box where the person reads it. Our own rules always run; then, when the
 * company allows a fast OpenAI model, that model polishes it: the voice already went to OpenAI for
 * transcription, so the text goes nowhere new (docs/SECURITY.md). Its version is kept only if it still
 * looks like what was said. Nothing is stored or logged but the usage (tokens, credits).
 */
export async function POST(request: Request) {
  const member = await memberOrNull();
  if (!member) return reply({ ok: false, error: "forbidden" }, 403);
  const supabase = await createClient();
  const { data: settings } = await supabase.from("company_ai_settings").select("dictation_enabled").eq("company_id", member.active.companyId).maybeSingle();
  if (settings && !settings.dictation_enabled) return reply({ ok: false, error: "disabled" }, 403);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ ok: false, error: "invalid" }, 400);
  const { text, locale } = parsed.data;
  const tidy = tidyDictation(text, locale);
  const words = tidy.split(/\s+/).filter(Boolean).length;
  if (fakeProviderEnabled() || words < CLEANUP_AI_MIN_WORDS || tidy.length > CLEANUP_AI_MAX_CHARS) return reply({ ok: true, text: tidy, polished: false });

  const models = await getCompanyModels(member.active.companyId);
  const fast = models.configured.has("openai") ? models.allowed.find((m) => m.provider === "openai" && m.tier === "fast") : undefined;
  if (!fast) return reply({ ok: true, text: tidy, polished: false });
  const result = await runMemoryTask(supabase, member, { system: cleanupSystem(locale), user: cleanupRequest(tidy), modelChoice: fast.id, feature: "dictation" });
  const polished = result.ok ? acceptCleanup(tidy, result.text) : null;
  return reply({ ok: true, text: polished ?? tidy, polished: Boolean(polished) });
}
