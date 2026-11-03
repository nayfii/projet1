import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { getMyMemberCard } from "@/modules/organizations/server/queries";
import { WelcomeForm } from "@/modules/organizations/ui/welcome-form";
import { avatarRate } from "@/modules/avatars/server/store";
import { fakeProviderEnabled } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("metaTitle") };
}

/** First screen for invited colleagues: avatar, name, job title and expertise (for Who Can Help). */
export default async function WelcomePage() {
  const ctx = await requireMember();
  const [card, rate] = await Promise.all([getMyMemberCard(ctx.active.companyId, ctx.user.id), avatarRate()]);
  return (
    <WelcomeForm
      companyName={ctx.active.companyName}
      fullName={ctx.profile.fullName}
      jobTitle={card?.job_title ?? ""}
      expertise={(card?.expertise ?? []).join(", ")}
      next={hasScope(ctx.active, "company") && !ctx.active.onboardingCompletedAt ? "/onboarding?step=company" : "/chat"}
      avatar={{ currentUrl: ctx.profile.avatarUrl, credits: rate.credits, testMode: fakeProviderEnabled(), name: ctx.profile.fullName ?? ctx.user.email }}
    />
  );
}
