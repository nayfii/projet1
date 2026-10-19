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
