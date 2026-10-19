import type { Database } from "@/lib/supabase/database.types";
import { PROVIDER_BRANDS, type ProviderId } from "./types";

export type ModelTier = Database["public"]["Enums"]["model_tier"];
type ModelRow = Database["public"]["Tables"]["ai_models"]["Row"];

/** A model of the platform catalogue (ai_models), as used by the router, the picker and billing. */
export type CatalogModel = {
  id: string;
  provider: ProviderId;
  apiModelId: string;
  label: string;
  tier: ModelTier;
  contextWindow: number;
  maxOutputTokens: number;
  supportsImages: boolean;
  strengths: string[];
  sortOrder: number;
  pricing: {
    inputUsdPerMtok: number;
    outputUsdPerMtok: number;
    cachedInputUsdPerMtok: number;
    inputCreditsPerMtok: number;
    outputCreditsPerMtok: number;
    cachedInputCreditsPerMtok: number;
  };
};

export function toCatalogModel(row: ModelRow): CatalogModel {
  return {
    id: row.id,
    provider: row.provider,
    apiModelId: row.api_model_id,
    label: row.label,
    tier: row.tier,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    supportsImages: row.supports_images,
    strengths: row.strengths ?? [],
    sortOrder: row.sort_order,
    pricing: {
      inputUsdPerMtok: Number(row.input_usd_per_mtok),
      outputUsdPerMtok: Number(row.output_usd_per_mtok),
      cachedInputUsdPerMtok: Number(row.cached_input_usd_per_mtok),
      inputCreditsPerMtok: Number(row.input_credits_per_mtok),
      outputCreditsPerMtok: Number(row.output_credits_per_mtok),
      cachedInputCreditsPerMtok: Number(row.cached_input_credits_per_mtok),
    },
  };
}

/** "Claude Sonnet 5.5" → { brand: "Claude", name: "Sonnet 5.5" }; "GPT-6.1 Sol" → { brand: "ChatGPT", name: "GPT-6.1 Sol" }. */
export function modelDisplay(provider: ProviderId, label: string): { brand: string; name: string } {
  const brand = PROVIDER_BRANDS[provider];
  const name = label.toLowerCase().startsWith(brand.toLowerCase() + " ") ? label.slice(brand.length + 1) : label;
  return { brand, name };
}

export const MODEL_CHOICE_AUTO = "auto";
