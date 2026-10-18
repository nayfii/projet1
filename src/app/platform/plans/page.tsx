import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { PageContainer } from "@/components/ui/page-header";
import { listPlans } from "@/modules/platform/server/queries";
import { PlansManager } from "@/modules/platform/ui/plans-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("plans") };
}

export default async function PlatformPlansPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platform");
  const plans = await listPlans();
  return (
    <PageContainer>
      <PlansManager header={{ title: t("plansTitle"), description: t("plansDescription") }} plans={plans} />
    </PageContainer>
  );
}
