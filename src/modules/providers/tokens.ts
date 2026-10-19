/**
 * Rough token estimate (about 3.5 characters per token for French and English text).
 * Used only to budget the context and to estimate an answer the user stopped before the
 * provider reported real counts. Billing uses the provider's counts whenever they exist.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Flat estimate for one image in the context (providers bill images by size; this is a budget guard). */
export const IMAGE_TOKEN_ESTIMATE = 1500;
