import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ACTIVITY_CATEGORIES, type ActivityCategory } from "../categories";

export const ACTIVITY_PAGE_SIZE = 50;

/**
 * Company activity log (requires the "activity" scope; enforced by RLS). Metadata only. Newest first,
 * one page at a time (`before`: the date of the last event already shown).
 */
export async function listCompanyActivity(
  companyId: string,
  filters: { category?: ActivityCategory; actorId?: string; sinceDays?: number | null; before?: string; limit?: number } = {},
) {
  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("id, action, target_type, target_id, metadata, created_at, actor_id, actor:profiles!audit_log_actor_id_fkey(full_name, email)")
    .eq("scope", "company")
    .eq("company_id", companyId);
  if (filters.category) query = query.or(ACTIVITY_CATEGORIES[filters.category].map((prefix) => `action.like.${prefix}*`).join(","));
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.sinceDays) query = query.gte("created_at", new Date(Date.now() - filters.sinceDays * 86_400_000).toISOString());
  if (filters.before) query = query.lt("created_at", filters.before);
  const { data } = await query.order("created_at", { ascending: false }).limit(filters.limit ?? ACTIVITY_PAGE_SIZE);
  return data ?? [];
}

export async function listPlatformActivity(limit = 100) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("id, action, target_type, target_id, metadata, created_at, actor_id")
    .eq("scope", "platform")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
