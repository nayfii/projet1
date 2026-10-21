import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProviderId } from "@/modules/providers/types";

type Row = { requests: number; input_tokens: number; output_tokens: number; credits: number; estimated_cost_usd: number };

export type UsageSummary = {
  /** AI credits only (the video pool is apart, in `video`). */
  totals: Row & { errors: number; estimated_tokens_requests: number; active_users: number };
  byUser: (Row & { user_id: string | null })[];
  byModel: (Row & { model_id: string | null; provider: ProviderId | null; auto_requests: number })[];
  byFeature: { feature: string; requests: number; credits: number; estimated_cost_usd: number }[];
  byDay: { day: string; requests: number; credits: number }[];
  video: { credits: number; renders: number; succeeded: number; failed: number };
};

const toNumbers = <T extends Record<string, unknown>>(row: T): T =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as T;

/** Usage dashboard data ("usage" scope, checked again in SQL). Metadata only. */
export async function getUsageSummary(companyId: string, from: Date, to: Date): Promise<UsageSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_usage_summary", {
    p_company: companyId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error || !data) return null;
  const raw = data as unknown as {
    totals: UsageSummary["totals"];
    by_user: UsageSummary["byUser"];
    by_model: UsageSummary["byModel"];
    by_feature: UsageSummary["byFeature"];
    by_day: UsageSummary["byDay"];
    video: UsageSummary["video"];
  };
  return {
    totals: toNumbers(raw.totals),
    byUser: raw.by_user.map(toNumbers),
    byModel: raw.by_model.map(toNumbers),
    byFeature: raw.by_feature.map(toNumbers),
    byDay: raw.by_day.map(toNumbers),
    video: toNumbers(raw.video),
  };
}

/** Credits used this month by each member, with their effective personal limit. */
export async function getMemberCredits(companyId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_member_credits", { p_company: companyId });
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    used: Number(r.credits_used),
    limit: r.personal_limit === null ? null : Number(r.personal_limit),
    hasOverride: r.has_override,
  }));
}

export async function getCompanyAiSettings(companyId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_ai_settings")
    .select("default_user_monthly_credits")
    .eq("company_id", companyId)
    .maybeSingle();
  return { defaultUserMonthlyCredits: data?.default_user_monthly_credits ?? null };
}

/** Platform console: credits and estimated AI cost per company this month (no content). */
export async function getPlatformCompanyCredits() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_company_credits");
  return new Map(
    (data ?? []).map((r) => [
      r.company_id,
      {
        limit: Number(r.credit_limit),
        used: Number(r.credits_used),
        granted: Number(r.granted),
        requests: Number(r.requests),
        estimatedCostUsd: Number(r.estimated_cost_usd),
      },
    ]),
  );
}
