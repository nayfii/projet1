import { describe, expect, it } from "vitest";
import { getProvider } from "@/modules/providers/server/registry";
import type { ChatEvent, ProviderId } from "@/modules/providers/types";

/**
 * Smoke test against the real provider APIs (`pnpm test:smoke`). Each configured provider gets
 * one tiny request per default model id; providers without a key are skipped, not failed.
 */
const MODELS: Record<ProviderId, string[]> = {
  openai: ["gpt-6-luna", "gpt-6.1-sol"],
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  google: ["gemini-flash-lite-latest", "gemini-flash-latest"],
};

async function collect(provider: ProviderId, apiModelId: string) {
  const events: ChatEvent[] = [];
  for await (const e of getProvider(provider).stream(
    {
      apiModelId,
      system: "Answer in one short sentence.",
      messages: [{ role: "user", content: [{ type: "text", text: "Say hello in French." }] }],
      maxOutputTokens: 2000,
    },
    new AbortController().signal,
  )) {
    events.push(e);
  }
  return events;
}

for (const provider of Object.keys(MODELS) as ProviderId[]) {
  describe.skipIf(!getProvider(provider).isConfigured())(`${provider} (real API)`, () => {
    it.each(MODELS[provider])("streams an answer and real token counts with %s", async (model) => {
      const events = await collect(provider, model);
      const error = events.find((e) => e.type === "error");
      if (error?.type === "error" && error.error.code === "provider_quota") {
        // The provider account has no credits for this model: report it, it is not a code failure.
        console.warn(`${provider}/${model}: provider account out of credits (provider_quota)`);
        return;
      }
      expect(error).toBeUndefined();
      const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
      expect(text.length).toBeGreaterThan(0);
      const usage = events.find((e) => e.type === "usage");
      expect(usage && usage.type === "usage" && usage.usage.inputTokens).toBeGreaterThan(0);
      expect(usage && usage.type === "usage" && usage.usage.outputTokens).toBeGreaterThan(0);
      console.info(`${provider}/${model}:`, JSON.stringify(text.slice(0, 80)), usage);
    });
  });
}

describe("error handling with a real provider", () => {
  it.skipIf(!getProvider("openai").isConfigured())("reports an unknown model as model_not_found, without throwing", async () => {
    const events = await collect("openai", "this-model-does-not-exist");
    const error = events.find((e) => e.type === "error");
    expect(error && error.type === "error" && error.error.code).toBe("model_not_found");
  });
});

describe("embeddings (real API)", () => {
  it.skipIf(!process.env.OPENAI_API_KEY || process.env.EMBEDDINGS_PROVIDER === "google")(
    "returns 1536-dimension vectors that put related texts closer",
    async () => {
      const { embedTexts } = await import("@/modules/providers/server/embeddings");
      const result = await embedTexts([
        "Délai de paiement des factures du client",
        "Le client règle ses factures à 45 jours fin de mois",
        "Recette de la tarte aux pommes",
      ]);
      if (!result.ok && result.error.code === "provider_quota") {
        // The provider account has no credits for embeddings: report it, it is not a code failure.
        console.warn("embeddings: provider account out of credits (provider_quota)");
        return;
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.vectors[0]).toHaveLength(1536);
      expect(result.tokens).toBeGreaterThan(0);
      const cos = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
      expect(cos(result.vectors[0], result.vectors[1])).toBeGreaterThan(cos(result.vectors[0], result.vectors[2]));
      console.info("embeddings:", result.model, "tokens", result.tokens, "similar", cos(result.vectors[0], result.vectors[1]).toFixed(3), "unrelated", cos(result.vectors[0], result.vectors[2]).toFixed(3));
    },
  );
});
