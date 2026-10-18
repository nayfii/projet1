import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Company activity log (requires the "activity" scope; enforced by RLS). Metadata only. */
export async function listCompanyActivity(companyId: string, limit = 100) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("id, action, target_type, target_id, metadata, created_at, actor:profiles!audit_log_actor_id_fkey(full_name, email)")
    .eq("scope", "company")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
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
