import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { getMyMemberCard } from "@/modules/organizations/server/queries";
import { ProfileForms } from "@/modules/identity/ui/profile-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage() {
  const ctx = await requireMember();
  const t = await getTranslations("profile");
  const card = await getMyMemberCard(ctx.active.companyId, ctx.user.id);
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title={t("title")} description={t("description")} />
      <ProfileForms
        email={ctx.user.email}
        fullName={ctx.profile.fullName ?? ""}
        locale={(await getLocale()) as "fr" | "en"}
        jobTitle={card?.job_title ?? ""}
        expertise={(card?.expertise ?? []).join(", ")}
        optOut={card?.who_can_help_opt_out ?? false}
      />
    </PageContainer>
  );
}
