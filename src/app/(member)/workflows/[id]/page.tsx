import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { editorContext, workflowForEditor } from "@/modules/workflows/server/queries";
import { WorkflowEditor } from "@/modules/workflows/ui/editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workflows");
  return { title: t("title") };
}

/** The workflow editor: library, canvas, Cendr AI copilot, settings, tests and runs. */
export default async function WorkflowPage({ params }: PageProps<"/workflows/[id]">) {
  const ctx = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const workflow = await workflowForEditor(ctx, id);
  if (!workflow) notFound();
  const context = await editorContext(ctx, id);
  // Editing: its author; a company workflow also the Owner and Admins with the "models" scope (the database checks too).
  const canEdit = workflow.mine || (workflow.scope === "company" && (ctx.active.role === "owner" || hasScope(ctx.active, "models")));
  return (
    <WorkflowEditor
      workflow={{ id: workflow.id, name: workflow.name, status: workflow.status, graph: workflow.graph, revision: workflow.revision, activeVersion: workflow.activeVersion, runs: workflow.runs, hasWebhookSecret: workflow.hasWebhookSecret }}
      context={context}
      canEdit={canEdit}
    />
  );
}
