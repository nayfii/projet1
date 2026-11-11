import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { AppearanceSettings } from "@/components/appearance/appearance-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("appearance");
  return { title: t("pageTitle") };
}

/** Our team's appearance choices (the console has no company profile page). */
export default async function PlatformAppearancePage() {
  await requirePlatformAdmin();
  const t = await getTranslations("appearance");
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title={t("pageTitle")} description={t("description")} />
      <AppearanceSettings />
    </PageContainer>
  );
}
