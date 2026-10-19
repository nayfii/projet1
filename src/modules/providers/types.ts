/**
 * Provider interface. The platform builds the whole context (system prompt, authorised history,
 * attachments) and hands it to a stateless adapter: providers keep nothing between requests.
 * Adding a provider = one adapter implementing ChatProvider + rows in the ai_models catalogue.
 */

export const PROVIDER_IDS = ["openai", "anthropic", "google"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: Uint8Array; mediaType: string };

export type ChatMessage = { role: "user" | "assistant"; content: ContentPart[] };

export type ChatRequest = {
  /** Model name sent to the provider API (ai_models.api_model_id). */
  apiModelId: string;
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
};

/** Token counts returned by the provider. */
export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Part of inputTokens read from the provider's short-lived prompt cache. */
  cachedInputTokens: number;
};

export const PROVIDER_ERROR_CODES = [
  "missing_key",
  "auth_failed",
  "rate_limited",
  /** The provider account itself is out of credits or billing is not set up (not a temporary limit). */
  "provider_quota",
  "unavailable",
  "model_not_found",
  "context_too_long",
  "content_filtered",
  "invalid_request",
  "unknown",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export type ProviderError = {
  code: ProviderErrorCode;
  /** True when trying again later (or with another model) may work. */
  retryable: boolean;
  /** HTTP status from the provider, for metadata-only logs. Never the response body. */
  status?: number;
};

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "usage"; usage: ChatUsage }
  | { type: "done"; finishReason: string }
  | { type: "error"; error: ProviderError };

export interface ChatProvider {
  id: ProviderId;
  /** False when the API key is missing: the model picker shows the model as unavailable. */
  isConfigured(): boolean;
  /** Streams events. Never throws: failures arrive as an "error" event. Ends silently on abort. */
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

/** Brand names shown to users next to each model ("ChatGPT · GPT-6.1 Sol"). */
export const PROVIDER_BRANDS: Record<ProviderId, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
};
