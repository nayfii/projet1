import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isAdminScope, type AdminScope, type CompanyRole } from "@/modules/organizations/scopes";

export type Membership = {
  companyId: string;
  companyName: string;
  companyStatus: "active" | "suspended";
  role: CompanyRole;
  adminScopes: AdminScope[];
  memberStatus: "active" | "deactivated";
  onboardingCompletedAt: string | null;
};

export type AppContext = {
  user: { id: string; email: string };
  profile: { fullName: string | null; avatarUrl: string | null; locale: "fr" | "en" | null; activeCompanyId: string | null };
  memberships: Membership[];
  /** The company the user is working in right now (active member of an active company). */
  active: Membership | null;
  isPlatformAdmin: boolean;
};

/** Everything the server needs to know about the signed-in user, loaded once per request. */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, membershipsRes, platformRes] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url, locale, active_company_id").eq("id", user.id).maybeSingle(),
    supabase.rpc("my_memberships"),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);

  const memberships: Membership[] = (membershipsRes.data ?? []).map((m) => ({
    companyId: m.company_id,
    companyName: m.company_name,
    companyStatus: m.company_status,
    role: m.role,
    adminScopes: (m.admin_scopes ?? []).filter(isAdminScope),
    memberStatus: m.member_status,
    onboardingCompletedAt: m.onboarding_completed_at ?? null,
  }));

  const usable = memberships.filter((m) => m.memberStatus === "active" && m.companyStatus === "active");
  const activeId = profileRes.data?.active_company_id;
  const active = usable.find((m) => m.companyId === activeId) ?? usable[0] ?? null;

  return {
    user: { id: user.id, email: user.email ?? "" },
    profile: {
      fullName: profileRes.data?.full_name ?? null,
      avatarUrl: profileRes.data?.avatar_url ?? null,
      locale: (profileRes.data?.locale as "fr" | "en" | null) ?? null,
      activeCompanyId: activeId ?? null,
    },
    memberships,
    active,
    isPlatformAdmin: Boolean(platformRes.data),
  };
});

export function hasScope(membership: Membership | null, scope: AdminScope): boolean {
  if (!membership) return false;
  return membership.role === "owner" || (membership.role === "admin" && membership.adminScopes.includes(scope));
}

export function isCompanyAdmin(membership: Membership | null): boolean {
  return membership?.role === "owner" || membership?.role === "admin";
}
