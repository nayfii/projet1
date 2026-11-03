import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { getCompanyModels } from "@/modules/providers/server/models";
import { ModelSettings } from "@/modules/providers/ui/model-settings";
import { AiFeatures } from "@/modules/providers/ui/ai-features";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("models") };
}

export default async function AdminModelsPage() {
  const ctx = await requireScope("models");
  const t = await getTranslations("modelSettings");
  const supabase = await createClient();
  const [models, { data: features }] = await Promise.all([
    getCompanyModels(ctx.active.companyId),
    supabase.from("company_ai_settings").select("auto_client_memory, dictation_enabled, web_search_enabled").eq("company_id", ctx.active.companyId).maybeSingle(),
  ]);
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
      <div className="mt-10">
        <AiFeatures
          initial={{
            autoClientMemory: features?.auto_client_memory ?? true,
            dictation: features?.dictation_enabled ?? true,
            webSearch: features?.web_search_enabled ?? true,
          }}
        />
      </div>
    </PageContainer>
  );
}
