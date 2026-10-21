import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/ui/page-header";
import { toCatalogModel } from "@/modules/providers/catalog";
import { configuredProviders } from "@/modules/providers/server/registry";
import { ModelsManager } from "@/modules/platform/ui/models-manager";
import { RenderRatesForm } from "@/modules/render/ui/render-rates-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("models") };
}

/** Platform admin: model catalogue, price estimates and credit rates. No customer data. */
export default async function PlatformModelsPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platformModels");
  const supabase = await createClient();
  const [{ data }, { data: rates }] = await Promise.all([
    supabase.from("ai_models").select("*").order("sort_order"),
    supabase.from("render_rates").select("kind, credits_per_second"),
  ]);
  const rate = (kind: string) => Number(rates?.find((r) => r.kind === kind)?.credits_per_second ?? 0);
  return (
    <PageContainer className="max-w-6xl">
      <ModelsManager
        header={{ title: t("title"), description: t("description") }}
        models={(data ?? []).map((row) => ({ ...toCatalogModel(row), isEnabled: row.is_enabled, defaultAllowed: row.default_allowed }))}
        configured={[...configuredProviders()]}
      />
      <div className="mt-8">
        <RenderRatesForm motion={rate("motion")} videoEdit={rate("video_edit")} />
      </div>
    </PageContainer>
  );
}
