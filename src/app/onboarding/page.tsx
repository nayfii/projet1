import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { getCompany, getMyPendingInvitations, listMembers } from "@/modules/organizations/server/queries";
import { OnboardingWizard } from "@/modules/organizations/ui/onboarding-wizard";
import { isSetupStep, type OnboardingStep } from "@/modules/organizations/onboarding-steps";
import { createClient } from "@/lib/supabase/server";
import { listMemorySpaces } from "@/modules/memory/server/queries";
import type { MemberContext } from "@/lib/auth/guards";
import { avatarRate } from "@/modules/avatars/server/store";
import { fakeProviderEnabled } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("metaTitle") };
}

/**
 * Onboarding (CLAUDE.md §11): the name, the company and the avatar, then straight to the first
 * conversation. Inviting the team, the first client and the first document are a checklist on the home
 * page; each opens its own short screen here and returns home.
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const ctx = await requireUser();
  const params = await searchParams;

  if (!ctx.active) {
    if (ctx.memberships.some((m) => m.companyStatus === "suspended" || m.memberStatus === "deactivated")) {
      redirect("/suspended");
    }
    const [invitations, { data: signupOpen }] = await Promise.all([getMyPendingInvitations(), (await createClient()).rpc("signup_open")]);
    return (
      <OnboardingWizard
        step="start"
        fullName={ctx.profile.fullName}
        email={ctx.user.email}
        invitations={invitations.map((i) => ({ id: i.invitation_id, companyName: i.company_name, invitedBy: i.invited_by_name }))}
        signupOpen={signupOpen === true}
      />
    );
  }

  // Invited members and admins without the company scope have nothing to set up here.
  if (!hasScope(ctx.active, "company")) redirect("/");
  const requested = typeof params.step === "string" ? params.step : "company";
  if (!isSetupStep(requested) && ctx.active.onboardingCompletedAt) redirect("/");
  const step: OnboardingStep = isSetupStep(requested) ? requested : requested === "avatar" ? "avatar" : "company";
  const company = await getCompany(ctx.active.companyId);
  const members = step === "client" ? await listMembers(ctx.active.companyId) : [];
  const companySpaceId =
    step === "document" ? ((await listMemorySpaces(ctx as MemberContext)).find((s) => s.kind === "company" && s.canWrite)?.spaceId ?? null) : null;

  return (
    <OnboardingWizard
      step={step}
      fullName={ctx.profile.fullName}
      email={ctx.user.email}
      company={company ? {
        name: company.name,
        industry: company.industry,
        sizeRange: company.size_range,
        website: company.website,
        description: company.description,
      } : null}
      members={members
        .filter((m) => m.status === "active" && m.role !== "owner")
        .map((m) => ({ userId: m.userId, name: m.fullName ?? m.email }))}
      companySpaceId={companySpaceId}
      avatar={step === "avatar" ? { currentUrl: ctx.profile.avatarUrl, credits: (await avatarRate()).credits, testMode: fakeProviderEnabled() } : undefined}
    />
  );
}
