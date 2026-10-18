import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Company metadata only (name, plan, seats, owner email). Never content. */
export async function listCompaniesForPlatform() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_list_companies");
  return data ?? [];
}

export async function listPlans() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("id, name, description, price_label, seat_limit, monthly_credits, video_credits, is_default, is_active, created_at")
    .order("created_at");
  return data ?? [];
}

export type PlanRow = Awaited<ReturnType<typeof listPlans>>[number];
