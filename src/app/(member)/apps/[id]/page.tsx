import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { getAgent } from "@/modules/agents/server/queries";
import { getToolEditorContext, reachableClients } from "@/modules/agents/server/editor-context";
import { AgentBadges } from "@/modules/agents/ui/agent-badges";
import { RunForm } from "@/modules/agents/ui/run-form";
import { agentText, type DynamicT } from "@/modules/agents/labels";

const UUID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({ params }: PageProps<"/apps/[id]">): Promise<Metadata> {
  const ctx = await requireMember();
  const { id } = await params;
  const agent = UUID.test(id) ? await getAgent(ctx, id) : null;
  return { title: agent ? agentText(agent, (await getTranslations("tools")) as unknown as DynamicT).name : undefined };
}

export default async function ToolPage({ params, searchParams }: PageProps<"/apps/[id]">) {
  const ctx = await requireMember();
  const { id } = await params;
  const { client } = await searchParams;
  const t = await getTranslations("tools");
  // RLS: a tool one may not see is "not found", without confirming it exists.
  const agent = UUID.test(id) ? await getAgent(ctx, id) : null;
  if (!agent) notFound();
  const supabase = await createClient();
  const [clients, editor, { data: features }] = await Promise.all([
    reachableClients(ctx),
    getToolEditorContext(ctx),
    supabase.from("company_ai_settings").select("dictation_enabled").eq("company_id", ctx.active.companyId).maybeSingle(),
  ]);
  const canDelete = !agent.builtin && (agent.mine || (agent.visibility !== "private" && hasScope(ctx.active, "agents")));

  return (
    <PageContainer className="max-w-3xl">
      <Link href="/apps" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        {t("libraryTitle")}
      </Link>
      <PageHeader
        title={agentText(agent, t as unknown as DynamicT).name}
        description={agentText(agent, t as unknown as DynamicT).description || undefined}
        actions={<AgentBadges agent={agent} />}
      />
      <RunForm agent={agent} clients={clients} editor={editor} canDelete={canDelete} initialClient={typeof client === "string" ? client : undefined}
        dictation={features?.dictation_enabled ?? true}
      />
    </PageContainer>
  );
}
