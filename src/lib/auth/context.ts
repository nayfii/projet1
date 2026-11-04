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
  profile: {
    fullName: string | null;
    avatarUrl: string | null;
    locale: "fr" | "en" | null;
    activeCompanyId: string | null;
    /** When the person chose a password in Cendr (null: they sign in with e-mail links). */
    passwordSetAt: string | null;
  };
  memberships: Membership[];
  /** The company the user is working in right now (active member of an active company). */
  active: Membership | null;
  isPlatformAdmin: boolean;
};

/** Everything the server needs to know about the signed-in user, loaded once per request. */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient();
  // The signed token is verified (locally when the project uses asymmetric signing keys: no round trip
  // per page). Access itself is enforced by the queries below and by RLS.
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) return null;
  const user = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };

  const [profileRes, membershipsRes, platformRes] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url, locale, active_company_id, password_set_at").eq("id", user.id).maybeSingle(),
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
      passwordSetAt: profileRes.data?.password_set_at ?? null,
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

/** May make a client restricted and manage who can open it (CLAUDE.md §11): client Admins, the Owner, Managers. */
export function canRestrictClients(m: Membership): boolean {
  return m.role === "manager" || hasScope(m, "clients");
}
