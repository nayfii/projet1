import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { getMyMemberCard } from "@/modules/organizations/server/queries";
import { WelcomeForm } from "@/modules/organizations/ui/welcome-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("metaTitle") };
}

/** First screen for invited colleagues: name, job title and expertise (for Who Can Help). */
export default async function WelcomePage() {
  const ctx = await requireMember();
  const card = await getMyMemberCard(ctx.active.companyId, ctx.user.id);
  return (
    <WelcomeForm
      companyName={ctx.active.companyName}
      fullName={ctx.profile.fullName}
      jobTitle={card?.job_title ?? ""}
      expertise={(card?.expertise ?? []).join(", ")}
    />
  );
}
