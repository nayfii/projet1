import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { integrationsPageData } from "@/modules/integrations/server/queries";
import { listMemorySpaces } from "@/modules/memory/server/queries";
import { getCompanyModels } from "@/modules/providers/server/models";
import { graphSchema, EMPTY_GRAPH } from "../graph";

export type WorkflowSummary = { id: string; name: string; scope: "personal" | "company"; status: "active" | "paused"; templateKey: string | null; lastRunAt: string | null; updatedAt: string; mine: boolean; lastRunStatus: string | null };

/** The workflows this person may see (theirs, the company's). */
export async function listWorkflows(ctx: MemberContext): Promise<{ ready: boolean; workflows: WorkflowSummary[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflows")
    .select("id, name, scope, status, template_key, last_run_at, updated_at, owner_id")
    .eq("company_id", ctx.active.companyId)
    .order("updated_at", { ascending: false });
  if (error) return { ready: false, workflows: [] };
  const ids = (data ?? []).map((w) => w.id);
  const { data: runs } = ids.length ? await supabase.from("workflow_runs").select("workflow_id, status, created_at").in("workflow_id", ids).order("created_at", { ascending: false }).limit(200) : { data: [] };
  const last = new Map<string, string>();
  for (const r of runs ?? []) if (!last.has(r.workflow_id)) last.set(r.workflow_id, r.status);
  return {
    ready: true,
    workflows: (data ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      scope: w.scope as WorkflowSummary["scope"],
      status: w.status as WorkflowSummary["status"],
      templateKey: w.template_key,
      lastRunAt: w.last_run_at,
      updatedAt: w.updated_at,
      mine: w.owner_id === ctx.user.id,
      lastRunStatus: last.get(w.id) ?? null,
    })),
  };
}

/** What the editor and the copilot may offer: the person's usable connections, writable memories, other workflows, models. */
export async function editorContext(ctx: MemberContext, workflowId: string) {
  const supabase = await createClient();
  const [integrations, spaces, { data: others }, models] = await Promise.all([
    integrationsPageData(ctx),
    listMemorySpaces(ctx),
    supabase.from("workflows").select("id, name").eq("company_id", ctx.active.companyId).neq("id", workflowId).eq("status", "active").limit(50),
    getCompanyModels(ctx.active.companyId),
  ]);
  const ready = new Set(integrations.availability.filter((a) => a.ready).map((a) => a.id as string));
  return {
    connections: integrations.connections
      .filter((c) => c.status === "active" && ready.has(c.provider) && (c.mine || c.scope === "company"))
      .map((c) => ({ id: c.id, provider: c.provider, apps: c.apps, label: c.accountLabel })),
    spaces: spaces.filter((s) => s.canWrite && !s.clientArchived).map((s) => ({ id: s.spaceId, kind: s.kind, name: s.clientName })),
    workflows: (others ?? []).map((w) => ({ id: w.id, name: w.name })),
    models: models.allowed.map((m) => ({ id: m.id, label: m.label, available: models.configured.has(m.provider) })),
  };
}

export async function workflowForEditor(ctx: MemberContext, id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workflows")
    .select("id, name, scope, status, owner_id, draft, draft_revision, active_version_id, webhook_secret_hash, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [{ data: versions }, { data: runs }] = await Promise.all([
    supabase.from("workflow_versions").select("id, version, created_at").eq("workflow_id", id).order("version", { ascending: false }).limit(10),
    supabase.from("workflow_runs").select("id, mode, trigger, status, error_code, created_at, finished_at").eq("workflow_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  return {
    id: data.id,
    name: data.name,
    scope: data.scope as "personal" | "company",
    status: data.status as "active" | "paused",
    mine: data.owner_id === ctx.user.id,
    graph: graphSchema.safeParse(data.draft).data ?? EMPTY_GRAPH,
    revision: data.draft_revision,
    activeVersion: (versions ?? []).find((v) => v.id === data.active_version_id)?.version ?? null,
    versions: (versions ?? []).map((v) => ({ id: v.id, version: v.version, createdAt: v.created_at })),
    hasWebhookSecret: Boolean(data.webhook_secret_hash),
    runs: (runs ?? []).map((r) => ({ id: r.id, mode: r.mode, trigger: r.trigger, status: r.status, errorCode: r.error_code, createdAt: r.created_at, finishedAt: r.finished_at })),
  };
}
