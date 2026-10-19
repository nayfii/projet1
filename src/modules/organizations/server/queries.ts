import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getCompany(companyId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("id, name, industry, size_range, description, website, default_locale, onboarding_completed_at, plan_id")
    .eq("id", companyId)
    .maybeSingle();
  return data;
}

export async function listMembers(companyId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_members")
    .select(
      "user_id, role, admin_scopes, status, job_title, expertise, who_can_help_opt_out, joined_at, team:teams(name), profile:profiles!company_members_user_id_fkey(full_name, email, avatar_url)",
    )
    .eq("company_id", companyId)
    .order("joined_at");
  return (data ?? []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    adminScopes: m.admin_scopes,
    status: m.status,
    jobTitle: m.job_title,
    expertise: m.expertise,
    optOut: m.who_can_help_opt_out,
    teamName: m.team?.name ?? null,
    joinedAt: m.joined_at,
    fullName: m.profile?.full_name ?? null,
    email: m.profile?.email ?? "",
    avatarUrl: m.profile?.avatar_url ?? null,
  }));
}

export type MemberRow = Awaited<ReturnType<typeof listMembers>>[number];

export async function listPendingInvitations(companyId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invitations")
    .select("id, email, role, created_at, expires_at")
    .eq("company_id", companyId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getMyMemberCard(companyId: string, userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_members")
    .select("job_title, expertise, who_can_help_opt_out")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function getMyPendingInvitations() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_pending_invitations");
  return data ?? [];
}

export async function getCompanyPlan(companyId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("plan:plans(name, seat_limit, monthly_credits, video_credits)")
    .eq("id", companyId)
    .maybeSingle();
  return data?.plan ?? null;
}
