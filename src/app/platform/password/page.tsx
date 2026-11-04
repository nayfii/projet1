import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { PasswordCard } from "@/modules/identity/ui/password-forms";
import { needsCurrentPassword } from "@/modules/identity/server/password-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("password");
  return { title: t("title") };
}

/** Our team's own password (the console has no company profile page). */
export default async function PlatformPasswordPage() {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("password");
  const needsCurrent = await needsCurrentPassword();
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title={t("title")} description={ctx.user.email} />
      <PasswordCard hasPassword={Boolean(ctx.profile.passwordSetAt)} needsCurrent={needsCurrent === true} />
    </PageContainer>
  );
}
