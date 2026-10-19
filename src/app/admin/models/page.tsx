import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { getCompanyModels } from "@/modules/providers/server/models";
import { ModelSettings } from "@/modules/providers/ui/model-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("models") };
}

export default async function AdminModelsPage() {
  const ctx = await requireScope("models");
  const t = await getTranslations("modelSettings");
  const models = await getCompanyModels(ctx.active.companyId);
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />
      <ModelSettings
        models={models.catalog.map((m) => ({
          id: m.id,
          provider: m.provider,
          label: m.label,
          tier: m.tier,
          configured: models.configured.has(m.provider),
        }))}
        initial={{ allowed: models.allowed.map((m) => m.id), defaultModelId: models.defaultModelId, autoEnabled: models.autoEnabled }}
      />
    </PageContainer>
  );
}
