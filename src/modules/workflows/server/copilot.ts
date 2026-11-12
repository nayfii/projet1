"use server";

import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/errors";
import { runMemoryTask, type MemoryTaskError } from "@/modules/memory/server/ai-tasks";
import { getCompanyModels } from "@/modules/providers/server/models";
import { graphSchema, type WfGraph } from "../graph";
import { NODES } from "../nodes";
import { applyOps, compactGraph, opSchema, opsAreSensitive, type GraphOp } from "../ops";
import { editorContext } from "./queries";

/**
 * The Cendr AI copilot of the workflow editor. It is shown a compact view of the workflow (types, links,
 * short settings — no secret, no run data), the nodes it may use, and the person's connections, memories
 * and workflows (ids and names only). It answers with a reply and structured changes, which are checked
 * and applied to a copy here; the editor shows them, asks first when they write outside, and can undo.
 */

const SYSTEM = [
  "Task: edit a workflow.",
  "You are Cendr AI, the copilot of a visual workflow editor for small companies. You change the workflow the person is editing.",
  "The context JSON gives: the workflow (nodes with id, type and config; edges from → to through an exit), the node types you may use with their settings, the person's connections (id, provider, apps), memories they may write in, their other workflows and the allowed AI models.",
  "Answer ONLY with JSON: {\"reply\": \"one or two short sentences to the person, in their language\", \"ops\": [...]}.",
  'Ops: {"op":"add_node","type":"<node type>","config":{...},"after":"<node id it follows>","handle":"<exit of that node, e.g. out, true, false, each, done>"} · {"op":"update_node","id":"<id>","config":{...},"type":"<optional new type of the same family>"} · {"op":"remove_node","id":"<id>"} · {"op":"connect","source":"<id>","target":"<id>","handle":"<exit>"} · {"op":"disconnect","source":"<id>","target":"<id>"}.',
  "Use only node types and setting keys from the context. Settings may use variables: {{trigger.<field>}}, {{steps.<node id>.<field>}} (text, label, items, answer…), {{vars.<name>}}, {{loop.item}}.",
  "For a connection setting, use the id of one of the person's connections that has a suitable app; if none fits, leave it empty and say which app to connect in Intégrations.",
  "To explain or answer a question without changing anything, return \"ops\": [].",
  "Never invent ids that are not in the context, never include secrets, keep the workflow as simple as possible.",
].join("\n");

export type CopilotResult = { reply: string; ops: GraphOp[]; graph: WfGraph; applied: number; rejected: number; sensitive: boolean };

export async function copilotAction(input: { workflowId: string; graph: unknown; message: string; history?: { role: "user" | "assistant"; text: string }[] }): Promise<ActionResult<CopilotResult> | { ok: false; error: MemoryTaskError }> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({
      workflowId: z.uuid(),
      graph: graphSchema,
      message: z.string().trim().min(1).max(2000),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(8).default([]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: wf } = await supabase.from("workflows").select("id").eq("id", parsed.data.workflowId).maybeSingle();
  if (!wf) return { ok: false, error: "not_found" };

  const [context, models] = await Promise.all([editorContext(ctx, parsed.data.workflowId), getCompanyModels(ctx.active.companyId)]);
  const catalog = NODES.filter((n) => n.status === "available").map((n) => ({
    type: n.type,
    exits: n.handles,
    settings: n.fields.map((f) => ({ key: f.key, kind: f.kind, required: Boolean(f.required), ...(f.options ? { options: f.options } : {}), ...(f.apps ? { apps: f.apps } : {}) })),
  }));
  const user = JSON.stringify({
    workflow: compactGraph(parsed.data.graph),
    node_types: catalog,
    connections: context.connections.map((c) => ({ id: c.id, provider: c.provider, apps: c.apps })),
    memories: context.spaces,
    workflows: context.workflows,
    models: models.allowed.map((m) => m.id),
    conversation: parsed.data.history,
    request: parsed.data.message,
  });
  const answer = await runMemoryTask(supabase, ctx, { system: SYSTEM, user, feature: "workflow" });
  if (!answer.ok) return { ok: false, error: answer.error };

  let reply = "";
  let ops: GraphOp[] = [];
  try {
    const json = JSON.parse(/\{[\s\S]*\}/.exec(answer.text)?.[0] ?? "{}") as { reply?: unknown; ops?: unknown[] };
    reply = typeof json.reply === "string" ? json.reply.slice(0, 1000) : "";
    ops = (Array.isArray(json.ops) ? json.ops : []).slice(0, 30).flatMap((o) => {
      const r = opSchema.safeParse(o);
      return r.success ? [r.data] : [];
    });
  } catch {
    reply = answer.text.slice(0, 1000);
  }
  const result = applyOps(parsed.data.graph, ops);
  return { ok: true, data: { reply, ops, graph: result.graph, applied: result.applied, rejected: result.rejected, sensitive: opsAreSensitive(parsed.data.graph, ops) } };
}
