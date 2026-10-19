import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { getHideSettings } from "@/modules/hide/server/masker";
import { HideSettingsForm } from "@/modules/hide/ui/hide-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("hide") };
}

/** Hide policies ("hide" scope): default modes, what Automatic masks, custom sensitive terms. */
export default async function AdminHidePage() {
  const ctx = await requireScope("hide");
  const t = await getTranslations("hideAdmin");
  const supabase = await createClient();
  const [settings, terms] = await Promise.all([
    getHideSettings(supabase, ctx.active.companyId),
    supabase.from("sensitive_terms").select("id, term, category").eq("company_id", ctx.active.companyId).order("term"),
  ]);
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />
      <HideSettingsForm
        // A new key after saving: the form starts again from the saved values.
        key={`${settings.defaultModes.join()}|${settings.autoCategories.join()}`}
        initial={settings}
        terms={(terms.data ?? []).map((r) => ({ id: r.id, term: r.term, category: r.category as "client" | "project" | "file" | "term" }))}
      />
    </PageContainer>
  );
}
