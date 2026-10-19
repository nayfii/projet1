import type { ProviderError } from "./types";

/**
 * Maps any error thrown by a provider SDK to a small set of codes the UI can explain.
 * Only the code and HTTP status are kept: provider errors can carry the request body
 * (the prompt), which must never reach logs or the browser.
 */
export function normalizeProviderError(error: unknown): ProviderError {
  const e = (error ?? {}) as {
    name?: string;
    statusCode?: number;
    status?: number;
    isRetryable?: boolean;
    responseBody?: string;
    message?: string;
    code?: string;
    cause?: unknown;
  };
  const name = e.name ?? "";

  if (name === "AI_LoadAPIKeyError" || name === "LoadAPIKeyError") return { code: "missing_key", retryable: false };

  const status = typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : undefined;
  // Response bodies are only inspected for a few well-known markers, never stored.
  const body = `${e.responseBody ?? ""} ${e.message ?? ""}`.toLowerCase();

  if (status !== undefined) {
    if (status === 401 || status === 403) return { code: "auth_failed", retryable: false, status };
    if (status === 404) return { code: "model_not_found", retryable: false, status };
    if (status === 408 || status === 409 || status === 425) return { code: "unavailable", retryable: true, status };
    if (status === 413) return { code: "context_too_long", retryable: false, status };
    if (status === 429) {
      if (/insufficient_quota|credit_balance|billing|no credits/.test(body)) return { code: "provider_quota", retryable: false, status };
      return { code: "rate_limited", retryable: true, status };
    }
    if (status >= 500) return { code: "unavailable", retryable: true, status };
    if (status === 400 || status === 422) {
      if (/context|too long|too many tokens|maximum.*tokens|token limit|prompt is too long/.test(body)) {
        return { code: "context_too_long", retryable: false, status };
      }
      if (/safety|content[_ ]?filter|content[_ ]?policy|blocked|harm/.test(body)) {
        return { code: "content_filtered", retryable: false, status };
      }
      return { code: "invalid_request", retryable: false, status };
    }
    return { code: "unknown", retryable: Boolean(e.isRetryable), status };
  }

  // No HTTP status: network failure, DNS, TLS, timeout.
  const causeCode = (e.cause as { code?: string } | undefined)?.code ?? e.code ?? "";
  if (
    name === "AI_RetryError" ||
    name === "TimeoutError" ||
    /ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR/.test(causeCode) ||
    /fetch failed|network|timeout|socket/.test(body)
  ) {
    // A RetryError wraps the last attempt: use its cause when it has a status.
    const last = (error as { lastError?: unknown })?.lastError;
    if (last && last !== error) {
      const inner = normalizeProviderError(last);
      if (inner.status !== undefined) return inner;
    }
    return { code: "unavailable", retryable: true };
  }
  return { code: "unknown", retryable: false };
}
