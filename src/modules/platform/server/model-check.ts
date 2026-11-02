import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { aiProviderKey, avatarImageModel, dictationModel, embeddingsConfig, fakeProviderEnabled } from "@/lib/env";
import { getProvider } from "@/modules/providers/server/registry";
import { embedTexts } from "@/modules/providers/server/embeddings";
import { normalizeProviderError } from "@/modules/providers/errors";
import type { ProviderErrorCode, ProviderId } from "@/modules/providers/types";

export type ModelCheckKind = "chat" | "embedding" | "dictation" | "avatar";

export type ModelCheck = {
  kind: ModelCheckKind;
  provider: ProviderId;
  label: string;
  apiModelId: string;
  ok: boolean;
  code: ProviderErrorCode | null;
  latencyMs: number;
};

const TIMEOUT_MS = 30_000;

async function timed(run: () => Promise<ProviderErrorCode | null>): Promise<{ code: ProviderErrorCode | null; latencyMs: number }> {
  const started = Date.now();
  let code: ProviderErrorCode | null;
  try {
    code = await run();
  } catch (error) {
    code = normalizeProviderError(error).code;
  }
  return { code, latencyMs: Date.now() - started };
}

/** A tiny request with no customer data ("Reply with the single word OK"). */
async function checkChatModel(provider: ProviderId, apiModelId: string): Promise<ProviderErrorCode | null> {
  const adapter = getProvider(provider);
  if (!adapter.isConfigured()) return "missing_key";
  let answered = false;
  let code: ProviderErrorCode | null = null;
  for await (const event of adapter.stream(
    {
      apiModelId,
      system: "Health check. Reply with the single word OK.",
      messages: [{ role: "user", content: [{ type: "text", text: "OK?" }] }],
      maxOutputTokens: 256,
    },
    AbortSignal.timeout(TIMEOUT_MS),
  )) {
    if (event.type === "error") code = event.error.code;
    if (event.type === "text" || event.type === "done") answered = true;
  }
  return code ?? (answered ? null : "unavailable");
}

/**
 * Speech and image models are checked without using them (no audio, no image is made): OpenAI says
 * whether this key may use the model. Credit is proven by the chat check on the same key.
 */
async function checkOpenAIModelAccess(model: string): Promise<ProviderErrorCode | null> {
  const key = aiProviderKey("openai");
  if (!key) return "missing_key";
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (response.ok) return null;
  return normalizeProviderError({ statusCode: response.status }).code;
}

/**
 * Platform console, "Test each model": every enabled chat model, the search index model, the dictation
 * model and the avatar image model, in parallel. No customer data; a few tokens per chat model, on our
 * account. In test mode nothing is called (the caller says so instead).
 */
export async function checkAllModels(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ModelCheck[]> {
  if (fakeProviderEnabled()) return [];
  const { data: models } = await supabase
    .from("ai_models")
    .select("provider, api_model_id, label, kind")
    .eq("is_enabled", true)
    .eq("kind", "chat")
    .order("sort_order");

  const embeddings = embeddingsConfig();
  const jobs: { kind: ModelCheckKind; provider: ProviderId; label: string; apiModelId: string; run: () => Promise<ProviderErrorCode | null> }[] = [
    ...(models ?? []).map((m) => ({
      kind: "chat" as const,
      provider: m.provider as ProviderId,
      label: m.label,
      apiModelId: m.api_model_id,
      run: () => checkChatModel(m.provider as ProviderId, m.api_model_id),
    })),
    {
      kind: "embedding",
      provider: embeddings.provider,
      label: embeddings.model,
      apiModelId: embeddings.model,
      run: async () => {
        const result = await embedTexts(["OK"]);
        return result.ok ? null : result.error.code;
      },
    },
    { kind: "dictation", provider: "openai", label: dictationModel(), apiModelId: dictationModel(), run: () => checkOpenAIModelAccess(dictationModel()) },
    { kind: "avatar", provider: "openai", label: avatarImageModel(), apiModelId: avatarImageModel(), run: () => checkOpenAIModelAccess(avatarImageModel()) },
  ];

  return Promise.all(
    jobs.map(async ({ run, ...job }) => {
      const { code, latencyMs } = await timed(run);
      return { ...job, ok: code === null, code, latencyMs };
    }),
  );
}
