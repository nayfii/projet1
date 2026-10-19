import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/ui/page-header";
import { toCatalogModel } from "@/modules/providers/catalog";
import { configuredProviders } from "@/modules/providers/server/registry";
import { ModelsManager } from "@/modules/platform/ui/models-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("models") };
}

/** Platform admin: model catalogue, price estimates and credit rates. No customer data. */
export default async function PlatformModelsPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platformModels");
  const supabase = await createClient();
  const { data } = await supabase.from("ai_models").select("*").order("sort_order");
  return (
    <PageContainer className="max-w-6xl">
      <ModelsManager
        header={{ title: t("title"), description: t("description") }}
        models={(data ?? []).map((row) => ({ ...toCatalogModel(row), isEnabled: row.is_enabled, defaultAllowed: row.default_allowed }))}
        configured={[...configuredProviders()]}
      />
    </PageContainer>
  );
}
