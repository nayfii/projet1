import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { listAdminAgents } from "@/modules/agents/server/queries";
import { AdminAgents } from "@/modules/agents/ui/admin-agents";
import { getToolEditorContext } from "@/modules/agents/server/editor-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("agents") };
}

/** Agents and tools ("agents" scope): approve company-wide tools, enable them per role. */
export default async function AdminAgentsPage() {
  const ctx = await requireScope("agents");
  const t = await getTranslations("tools");
  const [{ pending, shared, builtins }, editor] = await Promise.all([listAdminAgents(ctx), getToolEditorContext(ctx)]);
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title={t("adminTitle")} description={t("adminDescription")} />
      <AdminAgents pending={pending} shared={shared} builtins={builtins} models={editor.models} autoEnabled={editor.autoEnabled} />
    </PageContainer>
  );
}
