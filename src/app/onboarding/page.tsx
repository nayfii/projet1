import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { getCompany, getMyPendingInvitations } from "@/modules/organizations/server/queries";
import { OnboardingWizard, type OnboardingStep } from "@/modules/organizations/ui/onboarding-wizard";
import { listMembers } from "@/modules/organizations/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("metaTitle") };
}

const COMPANY_STEPS: OnboardingStep[] = ["company", "invite", "client", "document", "conversation"];

/**
 * Account → company → company profile → invite → first client → first document → first conversation.
 * Every step after company creation can be skipped.
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const ctx = await requireUser();
  const params = await searchParams;

  if (!ctx.active) {
    if (ctx.memberships.some((m) => m.companyStatus === "suspended" || m.memberStatus === "deactivated")) {
      redirect("/suspended");
    }
    const invitations = await getMyPendingInvitations();
    return (
      <OnboardingWizard
        step="start"
        fullName={ctx.profile.fullName}
        email={ctx.user.email}
        invitations={invitations.map((i) => ({ id: i.invitation_id, companyName: i.company_name, invitedBy: i.invited_by_name }))}
      />
    );
  }

  // Invited members and admins without the company scope have nothing to set up here.
  if (!hasScope(ctx.active, "company") || ctx.active.onboardingCompletedAt) redirect("/");

  const requested = typeof params.step === "string" ? (params.step as OnboardingStep) : "company";
  const step = COMPANY_STEPS.includes(requested) ? requested : "company";
  const company = await getCompany(ctx.active.companyId);
  const members = step === "client" ? await listMembers(ctx.active.companyId) : [];

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
      members={members.filter((m) => m.status === "active").map((m) => ({ userId: m.userId, name: m.fullName ?? m.email }))}
    />
  );
}
