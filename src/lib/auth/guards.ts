import "server-only";
import { notFound, redirect } from "next/navigation";
import { getAppContext, hasScope, isCompanyAdmin, type AppContext, type Membership } from "./context";
import type { AdminScope } from "@/modules/organizations/scopes";

/**
 * Server-side authorisation, used by every page, server action and route handler.
 * The database (RLS + RPC checks) enforces the same rules a second time.
 */

export async function requireUser(): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export type MemberContext = AppContext & { active: Membership };

export async function requireMember(): Promise<MemberContext> {
  const ctx = await requireUser();
  if (!ctx.active) {
    if (ctx.memberships.some((m) => m.companyStatus === "suspended" || m.memberStatus === "deactivated")) {
      redirect("/suspended");
    }
    if (ctx.isPlatformAdmin) redirect("/platform");
    redirect("/onboarding");
  }
  return ctx as MemberContext;
}

/** Owner or Admin: entry to the company admin console. */
export async function requireCompanyAdmin(): Promise<MemberContext> {
  const ctx = await requireMember();
  if (!isCompanyAdmin(ctx.active)) redirect("/");
  return ctx;
}

/** A specific management area (Owner always, Admin only if delegated). */
export async function requireScope(scope: AdminScope): Promise<MemberContext> {
  const ctx = await requireCompanyAdmin();
  if (!hasScope(ctx.active, scope)) redirect("/admin");
  return ctx;
}

export async function requirePlatformAdmin(): Promise<AppContext> {
  const ctx = await requireUser();
  if (!ctx.isPlatformAdmin) notFound();
  return ctx;
}

/** For server actions: returns the context or null instead of redirecting. */
export async function memberOrNull(scope?: AdminScope): Promise<MemberContext | null> {
  const ctx = await getAppContext();
  if (!ctx?.active) return null;
  if (scope && !hasScope(ctx.active, scope)) return null;
  return ctx as MemberContext;
}

export async function platformAdminOrNull(): Promise<AppContext | null> {
  const ctx = await getAppContext();
  return ctx?.isPlatformAdmin ? ctx : null;
}
