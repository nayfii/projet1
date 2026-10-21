import { describe, expect, it } from "vitest";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { createAiSdkProvider } from "@/modules/providers/server/ai-sdk-adapter";
import type { ChatEvent } from "@/modules/providers/types";

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 8, text: 8, reasoning: 0 },
};

function providerAnswering(text: string, finish: "stop" | "content-filter") {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "text-start", id: "t" },
        ...(text ? [{ type: "text-delta" as const, id: "t", delta: text }] : []),
        { type: "text-end", id: "t" },
        { type: "finish", usage, finishReason: { unified: finish, raw: finish === "content-filter" ? "refusal" : "end_turn" } },
      ]),
    }),
  });
  return createAiSdkProvider({ id: "anthropic", apiKey: () => "test-key", model: () => model });
}

async function collect(provider: ReturnType<typeof providerAnswering>) {
  const events: ChatEvent[] = [];
  for await (const e of provider.stream({ apiModelId: "claude-sonnet-5-5", system: "s", messages: [{ role: "user", content: [{ type: "text", text: "Bonjour" }] }], maxOutputTokens: 100 }, new AbortController().signal)) {
    events.push(e);
  }
  return events;
}

describe("provider adapter", () => {
  it("streams the answer, then the provider's token counts", async () => {
    const events = await collect(providerAnswering("Bonjour !", "stop"));
    expect(events).toEqual([
      { type: "text", delta: "Bonjour !" },
      { type: "usage", usage: { inputTokens: 120, outputTokens: 8, cachedInputTokens: 0 } },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("reports a refusal by the provider's safety filter as an error, still counting the tokens", async () => {
    const events = await collect(providerAnswering("", "content-filter"));
    expect(events).toEqual([
      { type: "usage", usage: { inputTokens: 120, outputTokens: 8, cachedInputTokens: 0 } },
      { type: "error", error: { code: "content_filtered", retryable: false } },
    ]);
  });
});
