import "server-only";
import type { CatalogModel } from "@/modules/providers/catalog";
import { getCompanyModels } from "@/modules/providers/server/models";
import { getMyQuota } from "@/modules/usage/server/quota";
import { CONFRONT_MIN_MODELS } from "../types";
import { confrontModels, estimateConfrontation, estimateSingleAnswer, pickJudge } from "../prompts";

export type ConfrontPlan =
  | { ok: false; reason: "not_enough_models" | "quota_user" | "quota_company"; models: CatalogModel[] }
  | {
      ok: true;
      models: CatalogModel[];
      judge: CatalogModel;
      /** Estimated credits for the whole confrontation, and for one normal answer. */
      credits: number;
      single: number;
      /** Credits left this month (the tighter of the company's and the person's limit). */
      remaining: number;
      enough: boolean;
    };

/**
 * Which models confront, who writes the synthesis and what it should cost, for a question whose
 * history totals `historyChars` characters. Shown before running and checked again when it runs.
 */
export async function planConfrontation(companyId: string, historyChars: number): Promise<ConfrontPlan> {
  const catalog = await getCompanyModels(companyId);
  const models = confrontModels(catalog.allowed, catalog.configured);
  if (models.length < CONFRONT_MIN_MODELS) return { ok: false, reason: "not_enough_models", models };
  const quota = await getMyQuota(companyId);
  if (!quota) return { ok: false, reason: "quota_company", models };
  if (quota.state.state === "blocked") return { ok: false, reason: quota.state.scope === "user" ? "quota_user" : "quota_company", models };

  const judge = pickJudge(models, catalog.allowed.find((m) => m.id === catalog.defaultModelId));
  // Same rough rule as the context builder: about 3.5 characters per token.
  const tokens = Math.ceil(Math.min(historyChars, 400_000) / 3.5);
  const credits = estimateConfrontation(models, judge, tokens);
  const single = estimateSingleAnswer(catalog.allowed.find((m) => m.id === catalog.defaultModelId) ?? judge, tokens);
  const s = quota.status;
  const remaining = Math.max(0, Math.min(s.companyLimit - s.companyUsed, s.userLimit === null ? Infinity : s.userLimit - s.userUsed));
  return { ok: true, models, judge, credits, single, remaining, enough: credits <= remaining };
}
