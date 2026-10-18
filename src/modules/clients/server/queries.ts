import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Clients visible to the signed-in user. RLS returns only what they may see:
 * Owner → all; members → Open clients + Restricted clients they are assigned to;
 * Admins with the "clients" scope → all (to manage them).
 */
export async function listClients(companyId: string, { includeArchived = false } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select(
      "id, name, visibility, sector, description, created_at, archived_at, assignments:client_assignments(user_id, profile:profiles!client_assignments_user_id_fkey(full_name, email, avatar_url))",
    )
    .eq("company_id", companyId)
    .order("name");
  if (!includeArchived) query = query.is("archived_at", null);
  const { data } = await query;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    visibility: c.visibility,
    sector: c.sector,
    description: c.description,
    createdAt: c.created_at,
    archivedAt: c.archived_at,
    assignees: (c.assignments ?? []).map((a) => ({
      userId: a.user_id,
      fullName: a.profile?.full_name ?? null,
      email: a.profile?.email ?? "",
      avatarUrl: a.profile?.avatar_url ?? null,
    })),
  }));
}

export type ClientRow = Awaited<ReturnType<typeof listClients>>[number];

export async function getClientById(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, company_id, name, visibility, sector, description, created_at, archived_at")
    .eq("id", clientId)
    .maybeSingle();
  return data;
}
