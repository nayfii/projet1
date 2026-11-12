import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { ComingSoon } from "@/components/ui/coming-soon";
import { listWorkflows } from "@/modules/workflows/server/queries";
import { WorkflowsHome } from "@/modules/workflows/ui/workflows-home";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workflows");
  return { title: t("title") };
}

/** Workflows (CLAUDE.md §12): automations made of steps, built visually or with Cendr AI. */
export default async function WorkflowsPage() {
  const ctx = await requireMember();
  const [t, data] = await Promise.all([getTranslations("workflows"), listWorkflows(ctx)]);
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title={t("title")} description={t("description")} />
      {data.ready ? (
        <WorkflowsHome workflows={data.workflows} canShare={ctx.active.role === "owner" || hasScope(ctx.active, "models")} />
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          <ComingSoon />
          {t("notReady")}
        </div>
      )}
    </PageContainer>
  );
}
