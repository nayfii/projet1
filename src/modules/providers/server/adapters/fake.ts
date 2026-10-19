import "server-only";
import type { ChatEvent, ChatProvider, ChatRequest, ProviderErrorCode, ProviderId } from "../../types";
import { estimateTokens } from "../../tokens";

/**
 * SIMULATED provider for automated tests (AI_FAKE_PROVIDER=true). It never calls a real API.
 * Its answers start with "[TEST]" so a simulated answer can never be mistaken for a real one.
 * Writing "[[fail:<code>]]" in a message simulates that provider error (e.g. [[fail:rate_limited]]);
 * "[[fail:<code>@<provider>]]" fails only with that provider (e.g. [[fail:unavailable@google]]).
 * "[[slow]]" writes the answer slowly (about 3 seconds), to test what happens mid-answer.
 */
export function createFakeProvider(id: ProviderId): ChatProvider {
  return {
    id,
    isConfigured: () => true,
    async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
      const last = request.messages.at(-1);
      const text = last?.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ") ?? "";
      const match = /\[\[fail:([a-z_]+)(?:@([a-z]+))?\]\]/.exec(text);
      const failure = match && (!match[2] || match[2] === id) ? match[1] : null;
      if (failure) {
        yield { type: "error", error: { code: failure as ProviderErrorCode, retryable: failure === "rate_limited" } };
        return;
      }
      // Memory tasks expect JSON.
      if (request.system.startsWith("Task: extract memory entries.")) {
        yield* simulated(JSON.stringify([{ title: "[TEST] Point clé", content: `[TEST] ${text.slice(0, 160)}` }]));
        return;
      }
      if (request.system.startsWith("Task: generalise a client note.")) {
        yield* simulated(JSON.stringify({ general: true, title: "[TEST] Enseignement général", content: "[TEST] Les clients de ce secteur préfèrent des points courts et réguliers." }));
        return;
      }
      const userTurns = request.messages.filter((m) => m.role === "user").length;
      // Memory passages are numbered "[S1] …" in the system prompt: cite the first one, like a real model would.
      const passages = [...request.system.matchAll(/^\[S(\d+)\] /gm)].length;
      const images = request.messages.flatMap((m) => m.content).filter((p) => p.type === "image").length;
      const answer = [
        `[TEST] Simulated answer from **${request.apiModelId}**.`,
        "",
        `- Messages received: ${request.messages.length} (${userTurns} from people)`,
        `- Images received: ${images}`,
        `- Your last message had ${text.length} characters.`,
        ...(passages > 0 ? [`- Knowledge passages received: ${passages}`, "", "Based on the company memory [S1]."] : []),
      ].join("\n");
      for (const word of answer.split(/(?<=\s)/)) {
        if (signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, text.includes("[[slow]]") ? 80 : 8));
        yield { type: "text", delta: word };
      }
      const input = estimateTokens(request.system) + request.messages.reduce((sum, m) => sum + estimateTokens(m.content.map((p) => (p.type === "text" ? p.text : "")).join("")), 0);
      yield { type: "usage", usage: { inputTokens: input, outputTokens: estimateTokens(answer), cachedInputTokens: 0 } };
      yield { type: "done", finishReason: "stop" };
    },
  };
}

async function* simulated(answer: string): AsyncIterable<ChatEvent> {
  yield { type: "text", delta: answer };
  yield { type: "usage", usage: { inputTokens: 100, outputTokens: estimateTokens(answer), cachedInputTokens: 0 } };
  yield { type: "done", finishReason: "stop" };
}
