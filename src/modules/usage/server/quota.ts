import "server-only";
import { createClient } from "@/lib/supabase/server";
import { evaluateQuota, type QuotaState, type QuotaStatus } from "../quota";

/** The signed-in user's credits this month (company and personal), read through an RPC that checks membership. */
export async function getMyQuota(companyId: string): Promise<{ status: QuotaStatus; state: QuotaState } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_quota_status", { p_company: companyId });
  const row = data?.[0];
  if (error || !row) return null;
  const status: QuotaStatus = {
    periodStart: row.period_start,
    companyLimit: Number(row.company_limit),
    companyUsed: Number(row.company_used),
    userLimit: row.user_limit === null ? null : Number(row.user_limit),
    userUsed: Number(row.user_used),
  };
  return { status, state: evaluateQuota(status) };
}
