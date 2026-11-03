import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { DEPARTMENTS, MEMORY_SCOPES, OUTPUT_FORMATS, fieldSchema, type AgentField, type ToolInput } from "@/modules/agents/definitions";
import { AppsManager, type PlatformApp } from "@/modules/platform/ui/apps-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("apps") };
}

const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T => ((list as readonly string[]).includes(value) ? (value as T) : fallback);

/** Platform → Applis: launch switches and the apps our team adds for every customer. No customer data. */
export default async function PlatformAppsPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platformApps");
  const supabase = await createClient();
  const [{ data: settings }, { data: rows }] = await Promise.all([
    supabase.from("platform_settings").select("video_apps_enabled, app_review_enabled").maybeSingle(),
    supabase
      .from("agents")
      .select("id, name, description, department, instructions, input_fields, tools, memory_scope, output_format, enabled_roles")
      .is("company_id", null)
      .like("builtin_key", "platform\\_%")
      .order("name"),
  ]);
  const apps: PlatformApp[] = (rows ?? []).map((r) => ({
    id: r.id,
    enabled: r.enabled_roles.length > 0,
    app: {
      name: r.name,
      description: r.description,
      department: oneOf(DEPARTMENTS, r.department, "general"),
      instructions: r.instructions,
      input_fields: Array.isArray(r.input_fields) ? r.input_fields.flatMap((f) => (fieldSchema.safeParse(f).success ? [f as AgentField] : [])) : [],
      allowed_models: [],
      default_model: null,
      tools: r.tools.includes("attachments") ? ["attachments"] : [],
      memory_scope: oneOf(MEMORY_SCOPES, r.memory_scope, "company_and_client"),
      output_format: oneOf(OUTPUT_FORMATS, r.output_format, "text"),
    } satisfies ToolInput,
  }));

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title={t("title")} description={t("description")} />
      <AppsManager switches={{ video: settings?.video_apps_enabled ?? false, appReview: settings?.app_review_enabled ?? false }} apps={apps} />
    </PageContainer>
  );
}
