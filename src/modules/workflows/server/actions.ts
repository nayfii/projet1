"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { usableConnection } from "@/modules/integrations/server/access";
import { graphSchema, nextRun, sensitivities, validateGraph, type GraphIssue, type WfGraph } from "../graph";
import { nodeDef } from "../nodes";
import type { Sensitivity } from "../nodes";
import { templateGraph, TEMPLATES } from "../templates";
import { createVersion, logWorkflow, rotateWebhookSecret, setActive, setPaused } from "./control";
import { enqueueRun, executeRun } from "./engine";
import { actorFor } from "./runtime";

/**
 * Workflows, as the person sees them. Every change checks their right to edit with their own session
 * (RLS) first; our server then does what only it may do (versions, status, runs).
 */

export async function createWorkflowAction(input: { name: string; template?: string | null; scope?: "personal" | "company" }): Promise<ActionResult<{ id: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ name: z.string().trim().min(1).max(120), template: z.string().max(60).nullish(), scope: z.enum(["personal", "company"]).default("personal") }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const template = parsed.data.template && TEMPLATES.some((t) => t.key === parsed.data.template) ? parsed.data.template : null;
  const draft = template ? templateGraph(template, (await getLocale()) === "en" ? "en" : "fr")! : { nodes: [{ id: "n1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} }], edges: [] };
  const { data, error } = await (await createClient())
    .from("workflows")
    .insert({ company_id: ctx.active.companyId, scope: parsed.data.scope, name: parsed.data.name, template_key: template, draft: draft as never })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/workflows");
  return { ok: true, data: { id: data.id } };
}

/** Autosave of the draft. `revision` must be the one the editor started from (no silent overwrite). */
export async function saveDraftAction(input: { id: string; graph: unknown; revision: number; name?: string }): Promise<ActionResult<{ revision: number }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.id);
  const graph = graphSchema.safeParse(input.graph);
  if (!id.success || !graph.success || !Number.isInteger(input.revision)) return { ok: false, error: "validation" };
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : undefined;
  const { data, error } = await (await createClient())
    .from("workflows")
    .update({ draft: graph.data as never, draft_revision: input.revision + 1, ...(name ? { name } : {}) })
    .eq("id", id.data)
    .eq("draft_revision", input.revision)
    .select("draft_revision")
    .maybeSingle();
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!data) return { ok: false, error: "conflict" };
  return { ok: true, data: { revision: data.draft_revision } };
}

async function editable(id: string) {
  const { data } = await (await createClient()).from("workflows").select("id, company_id, owner_id, status, draft, active_version_id").eq("id", id).maybeSingle();
  return data;
}

/** Checks a graph for the workflow's author: settings and connections they may use. */
async function checkGraph(companyId: string, ownerId: string, graph: WfGraph): Promise<GraphIssue[]> {
  const actor = await actorFor(companyId, ownerId).catch(() => null);
  if (!actor) return [{ node: null, code: "bad_connection" }];
  const usable = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const id = n.config.connection;
    if (typeof id === "string" && id && !usable.has(id)) {
      const found = await usableConnection(actor.ctx, id);
      usable.set(id, found && found.row.status === "active" ? found.row.apps : []);
    }
  }
  return validateGraph(graph, (type, connectionId) => {
    const apps = usable.get(connectionId) ?? [];
    return Object.keys(nodeDef(type)?.capabilities ?? {}).some((a) => apps.includes(a));
  });
}

export type PlayResult = { status: "active" } | { status: "confirm"; sensitivities: Sensitivity[] } | { status: "invalid"; issues: GraphIssue[] };

/**
 * PLAY: the draft becomes a new immutable version and the workflow runs automatically from now on.
 * When it may write to clients, publish or change data, the person confirms once, knowing what.
 */
export async function playWorkflowAction(input: { id: string; confirmed?: boolean }): Promise<ActionResult<PlayResult & { webhookSecret?: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "validation" };
  const wf = await editable(id.data);
  if (!wf) return { ok: false, error: "not_found" };
  const graph = graphSchema.safeParse(wf.draft);
  if (!graph.success) return { ok: true, data: { status: "invalid", issues: [{ node: null, code: "no_trigger" }] } };
  const issues = await checkGraph(wf.company_id, wf.owner_id, graph.data);
  if (issues.length) return { ok: true, data: { status: "invalid", issues } };
  const sensitive = sensitivities(graph.data);
  if (sensitive.length && !input.confirmed) return { ok: true, data: { status: "confirm", sensitivities: sensitive } };

  const versionId = await createVersion(wf.id, wf.company_id, ctx.user.id, graph.data);
  const trigger = graph.data.nodes.find((n) => nodeDef(n.type)?.category === "trigger")!;
  const next = trigger.type === "trigger.schedule" ? nextRun(trigger.config, new Date()).toISOString() : trigger.type === "trigger.email" ? new Date().toISOString() : null;
  await setActive(wf.id, versionId, next);
  let webhookSecret: string | undefined;
  if (trigger.type === "trigger.webhook") {
    const { data } = await (await createClient()).from("workflows").select("webhook_secret_hash").eq("id", wf.id).maybeSingle();
    if (!data?.webhook_secret_hash) webhookSecret = await rotateWebhookSecret(wf.id);
  }
  await logWorkflow(wf.company_id, ctx.user.id, "workflow.activated", wf.id, { sensitivities: sensitive, confirmed: Boolean(input.confirmed) });
  revalidatePath(`/workflows/${wf.id}`);
  revalidatePath("/workflows");
  return { ok: true, data: { status: "active", webhookSecret } };
}

/** PAUSE: no new automatic run; runs waiting in the queue are cancelled. What was already done stays done. */
export async function pauseWorkflowAction(input: { id: string }): Promise<ActionResult<{ cancelled: number }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "validation" };
  const wf = await editable(id.data);
  if (!wf) return { ok: false, error: "not_found" };
  const cancelled = await setPaused(wf.id);
  await logWorkflow(wf.company_id, ctx.user.id, "workflow.paused", wf.id, { cancelled });
  revalidatePath(`/workflows/${wf.id}`);
  revalidatePath("/workflows");
  return { ok: true, data: { cancelled } };
}

/**
 * Runs now. "test": the current draft, with test data; reads and AI for real, actions only shown (never
 * sent). "live": the active version, actions for real (only when the workflow is on).
 */
export async function runWorkflowAction(input: { id: string; mode: "test" | "live"; data?: string }): Promise<ActionResult<{ runId: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ id: z.uuid(), mode: z.enum(["test", "live"]), data: z.string().max(50_000).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const wf = await editable(parsed.data.id);
  if (!wf) return { ok: false, error: "not_found" };
  let payload: Record<string, unknown> = { text: parsed.data.data ?? "" };
  try {
    const json = JSON.parse(parsed.data.data ?? "");
    if (json && typeof json === "object" && !Array.isArray(json)) payload = { ...json, text: parsed.data.data };
  } catch {
    // Plain text: available as {{trigger.text}}.
  }
  if (parsed.data.mode === "test") {
    const graph = graphSchema.safeParse(wf.draft);
    if (!graph.success || !graph.data.nodes.some((n) => nodeDef(n.type)?.category === "trigger")) return { ok: false, error: "validation" };
    const run = await enqueueRun({ workflowId: wf.id, companyId: wf.company_id, mode: "test", trigger: "test", triggeredBy: ctx.user.id, input: payload, graph: graph.data });
    after(() => executeRun(run.id));
    return { ok: true, data: { runId: run.id } };
  }
  if (wf.status !== "active" || !wf.active_version_id) return { ok: false, error: "forbidden" };
  const run = await enqueueRun({ workflowId: wf.id, companyId: wf.company_id, mode: "live", trigger: "manual", triggeredBy: ctx.user.id, input: payload, versionId: wf.active_version_id });
  after(() => executeRun(run.id));
  return { ok: true, data: { runId: run.id } };
}

export type RunView = {
  id: string;
  mode: "live" | "test";
  trigger: string;
  status: string;
  errorCode: string | null;
  errorNode: string | null;
  createdAt: string;
  finishedAt: string | null;
  steps: { nodeId: string; nodeType: string; iteration: number; status: string; output: unknown; errorCode: string | null; durationMs: number | null }[];
};

/** A run and its steps (the editor polls it while it runs). */
export async function getRunAction(input: { runId: string }): Promise<ActionResult<RunView>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.runId);
  if (!id.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const [{ data: run }, { data: steps }] = await Promise.all([
    supabase.from("workflow_runs").select("id, mode, trigger, status, error_code, error_node, created_at, finished_at").eq("id", id.data).maybeSingle(),
    supabase.from("workflow_run_steps").select("node_id, node_type, iteration, status, output, error_code, duration_ms, started_at").eq("run_id", id.data).order("started_at"),
  ]);
  if (!run) return { ok: false, error: "not_found" };
  return {
    ok: true,
    data: {
      id: run.id,
      mode: run.mode as RunView["mode"],
      trigger: run.trigger,
      status: run.status,
      errorCode: run.error_code,
      errorNode: run.error_node,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
      steps: (steps ?? []).map((s) => ({ nodeId: s.node_id, nodeType: s.node_type, iteration: s.iteration, status: s.status, output: s.output, errorCode: s.error_code, durationMs: s.duration_ms })),
    },
  };
}

export async function deleteWorkflowAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "validation" };
  const wf = await editable(id.data);
  if (!wf) return { ok: false, error: "not_found" };
  await setPaused(wf.id);
  const { error } = await (await createClient()).from("workflows").delete().eq("id", wf.id);
  if (error) return { ok: false, error: toErrorCode(error) };
  await logWorkflow(wf.company_id, ctx.user.id, "workflow.deleted", wf.id);
  revalidatePath("/workflows");
  return { ok: true };
}

/** A new secret for the webhook trigger (the old one stops working at once). Shown once. */
export async function rotateWebhookAction(input: { id: string }): Promise<ActionResult<{ secret: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "validation" };
  const wf = await editable(id.data);
  if (!wf) return { ok: false, error: "not_found" };
  const secret = await rotateWebhookSecret(wf.id);
  await logWorkflow(wf.company_id, ctx.user.id, "workflow.webhook_secret", wf.id);
  return { ok: true, data: { secret } };
}
