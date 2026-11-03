import "server-only";
import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { normalizeProviderError } from "../errors";
import type { ChatEvent, ChatMessage, ChatProvider, ChatRequest, ProviderId } from "../types";

type ProviderOptions = Parameters<typeof streamText>[0]["providerOptions"];

/**
 * Wraps one Vercel AI SDK provider in our ChatProvider interface. The adapters only translate
 * the wire format: the content they receive is already built (and, later, masked) by the platform.
 */
export function createAiSdkProvider(options: {
  id: ProviderId;
  apiKey: () => string | undefined;
  model: (apiModelId: string, apiKey: string) => LanguageModel;
  providerOptions?: ProviderOptions;
  /** The provider's own web search tool (run by the provider, results cited as sources). */
  webSearchTools?: (apiKey: string) => ToolSet;
}): ChatProvider {
  return {
    id: options.id,
    isConfigured: () => Boolean(options.apiKey()),
    async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
      const apiKey = options.apiKey();
      if (!apiKey) {
        yield { type: "error", error: { code: "missing_key", retryable: false } };
        return;
      }
      let failed = false;
      try {
        const result = streamText({
          model: options.model(request.apiModelId, apiKey),
          instructions: request.system,
          messages: toModelMessages(request.messages),
          maxOutputTokens: request.maxOutputTokens,
          abortSignal: signal,
          maxRetries: 1,
          providerOptions: options.providerOptions,
          tools: request.webSearch && options.webSearchTools ? options.webSearchTools(apiKey) : undefined,
          // The SDK's default handler logs the full error, which can include the prompt. Never log it.
          onError: () => {},
        });
        for await (const part of result.stream) {
          if (part.type === "text-delta") {
            if (part.text) yield { type: "text", delta: part.text };
          } else if (part.type === "tool-call" && part.providerExecuted) {
            yield { type: "web_search" };
          } else if (part.type === "source" && part.sourceType === "url") {
            yield { type: "web_source", url: part.url, title: part.title ?? null };
          } else if (part.type === "finish") {
            const usage = part.totalUsage;
            const input = usage.inputTokens ?? 0;
            const cached = usage.inputTokenDetails?.cacheReadTokens ?? 0;
            yield {
              type: "usage",
              usage: { inputTokens: input, outputTokens: usage.outputTokens ?? 0, cachedInputTokens: Math.min(cached, input) },
            };
            // A provider's safety filter declined (Claude: stop_reason "refusal", HTTP 200): say so instead
            // of showing an empty or cut answer as if it were complete. The tokens used are still counted.
            if (part.finishReason === "content-filter") {
              yield { type: "error", error: { code: "content_filtered", retryable: false } };
              return;
            }
            yield { type: "done", finishReason: part.finishReason };
          } else if (part.type === "error") {
            failed = true;
            yield { type: "error", error: normalizeProviderError(part.error) };
            return;
          } else if (part.type === "abort") {
            return;
          }
        }
      } catch (error) {
        if (signal.aborted || failed) return;
        yield { type: "error", error: normalizeProviderError(error) };
      }
    },
  };
}

function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant") {
      return { role: "assistant", content: m.content.map((p) => (p.type === "text" ? p.text : "")).join("") };
    }
    return {
      role: "user",
      content: m.content.map((p) =>
        p.type === "text"
          ? { type: "text" as const, text: p.text }
          : { type: "file" as const, data: { type: "data" as const, data: p.data }, mediaType: p.mediaType },
      ),
    };
  });
}
