import "server-only";
import { createClient } from "@/lib/supabase/server";
import { MODEL_CHOICE_AUTO, toCatalogModel, type CatalogModel } from "../catalog";
import { routeRequest, type RouterInput, type RoutingDecision } from "../router";
import type { ProviderId } from "../types";
import { configuredProviders } from "./registry";

export type CompanyModels = {
  /** Every enabled model of the platform catalogue. */
  catalog: CatalogModel[];
  /** Models the company allows (enabled ones only). */
  allowed: CatalogModel[];
  autoEnabled: boolean;
  /** Null = Auto. */
  defaultModelId: string | null;
  /** Providers whose API key is present on the server. */
  configured: Set<ProviderId>;
};

/** Read with the user's session: RLS lets members read their company's settings and the catalogue. */
export async function getCompanyModels(companyId: string): Promise<CompanyModels> {
  const supabase = await createClient();
  const [catalogRes, allowedRes, settingsRes] = await Promise.all([
    supabase.from("ai_models").select("*").eq("is_enabled", true).order("sort_order"),
    supabase.from("company_allowed_models").select("model_id").eq("company_id", companyId),
    supabase.from("company_ai_settings").select("auto_enabled, default_model_id").eq("company_id", companyId).maybeSingle(),
  ]);
  const catalog = (catalogRes.data ?? []).map(toCatalogModel);
  const allowedIds = new Set((allowedRes.data ?? []).map((r) => r.model_id));
  const allowed = catalog.filter((m) => allowedIds.has(m.id));
  const autoEnabled = settingsRes.data?.auto_enabled ?? true;
  const defaultModelId =
    settingsRes.data?.default_model_id && allowedIds.has(settingsRes.data.default_model_id) ? settingsRes.data.default_model_id : null;
  return { catalog, allowed, autoEnabled, defaultModelId, configured: configuredProviders() };
}

/** The choice preselected in a new conversation: the company default, else Auto, else the first usable model. */
export function defaultChoice(models: CompanyModels): string {
  if (models.defaultModelId) return models.defaultModelId;
  if (models.autoEnabled) return MODEL_CHOICE_AUTO;
  return models.allowed.find((m) => models.configured.has(m.provider))?.id ?? models.allowed[0]?.id ?? MODEL_CHOICE_AUTO;
}

export type ModelResolution =
  | { ok: true; model: CatalogModel; routing: RoutingDecision | null }
  | { ok: false; error: "model_not_allowed" | "auto_disabled" | "no_model_available" | "missing_key"; model?: CatalogModel };

/** Turns "auto" or a model id into the model that will answer, enforcing the company's rules. */
export function resolveModel(choice: string, models: CompanyModels, input: RouterInput): ModelResolution {
  if (choice === MODEL_CHOICE_AUTO) {
    if (!models.autoEnabled) return { ok: false, error: "auto_disabled" };
    const usable = models.allowed.filter((m) => models.configured.has(m.provider));
    const decision = routeRequest(input, usable);
    if (!decision) return { ok: false, error: "no_model_available" };
    return { ok: true, model: usable.find((m) => m.id === decision.modelId)!, routing: decision };
  }
  const model = models.allowed.find((m) => m.id === choice);
  if (!model) return { ok: false, error: "model_not_allowed" };
  if (!models.configured.has(model.provider)) return { ok: false, error: "missing_key", model };
  return { ok: true, model, routing: null };
}
