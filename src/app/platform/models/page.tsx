import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/ui/page-header";
import { toCatalogModel } from "@/modules/providers/catalog";
import { configuredProviders } from "@/modules/providers/server/registry";
import { ModelsManager } from "@/modules/platform/ui/models-manager";
import { RenderRatesForm } from "@/modules/render/ui/render-rates-form";
import { AvatarRateForm } from "@/modules/avatars/ui/avatar-rate-form";
import { DictationRateForm } from "@/modules/dictation/ui/dictation-rate-form";
import { avatarImageModel, dictationModel } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("models") };
}

/** Platform admin: model catalogue, price estimates and credit rates. No customer data. */
export default async function PlatformModelsPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platformModels");
  const supabase = await createClient();
  const [{ data }, { data: rates }, { data: settings }] = await Promise.all([
    supabase.from("ai_models").select("*").order("sort_order"),
    supabase.from("render_rates").select("kind, credits_per_second"),
    supabase
      .from("platform_settings")
      .select("avatar_credits, avatar_cost_usd, dictation_credits_per_minute, dictation_cost_usd_per_minute")
      .maybeSingle(),
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
      <div className="mt-6">
        <AvatarRateForm credits={Number(settings?.avatar_credits ?? 0)} costUsd={Number(settings?.avatar_cost_usd ?? 0)} model={avatarImageModel()} />
      </div>
      <div className="mt-6">
        <DictationRateForm
          credits={Number(settings?.dictation_credits_per_minute ?? 0)}
          costUsd={Number(settings?.dictation_cost_usd_per_minute ?? 0)}
          model={dictationModel()}
        />
      </div>
    </PageContainer>
  );
}
