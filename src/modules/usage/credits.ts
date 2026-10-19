import type { CatalogModel } from "@/modules/providers/catalog";
import type { ChatUsage } from "@/modules/providers/types";

/**
 * Credits and estimated cost of one request, from the provider's token counts and the catalogue
 * rates in force at that moment. The result is stored on the usage event, so later price changes
 * never rewrite history. Costs are ESTIMATES (public price lists), not invoices.
 */
export function computeCharge(pricing: CatalogModel["pricing"], usage: ChatUsage): { credits: number; estimatedCostUsd: number } {
  const cached = Math.min(Math.max(usage.cachedInputTokens, 0), Math.max(usage.inputTokens, 0));
  const fresh = Math.max(usage.inputTokens - cached, 0);
  const output = Math.max(usage.outputTokens, 0);
  const per = (tokens: number, ratePerMillion: number) => (tokens * ratePerMillion) / 1_000_000;
  const credits = per(fresh, pricing.inputCreditsPerMtok) + per(cached, pricing.cachedInputCreditsPerMtok) + per(output, pricing.outputCreditsPerMtok);
  const cost = per(fresh, pricing.inputUsdPerMtok) + per(cached, pricing.cachedInputUsdPerMtok) + per(output, pricing.outputUsdPerMtok);
  return { credits: round(credits, 4), estimatedCostUsd: round(cost, 6) };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
