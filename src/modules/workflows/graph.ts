import { z } from "zod";
import { NODES, nodeDef, WORKFLOW_LIMITS, type Sensitivity } from "./nodes";

/** A workflow as stored (draft or version) and edited: nodes with settings, and the links between them. */
export type WfNode = { id: string; type: string; position: { x: number; y: number }; config: Record<string, unknown> };
export type WfEdge = { id: string; source: string; target: string; handle: string };
export type WfGraph = { nodes: WfNode[]; edges: WfEdge[] };

const nodeTypes = NODES.map((n) => n.type) as [string, ...string[]];
export const graphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
        type: z.enum(nodeTypes),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }),
        config: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(WORKFLOW_LIMITS.nodes),
  edges: z
    .array(z.object({ id: z.string().max(100), source: z.string().max(40), target: z.string().max(40), handle: z.string().max(10).default("out") }))
    .max(WORKFLOW_LIMITS.nodes * 3),
});

export const EMPTY_GRAPH: WfGraph = { nodes: [], edges: [] };

export type GraphIssue = { node: string | null; code: "no_trigger" | "two_triggers" | "into_trigger" | "unreachable" | "cycle" | "missing_field" | "bad_handle" | "dangling" | "soon" | "too_many" | "bad_connection"; field?: string };

/**
 * Checks a graph before it can run: one trigger, every node reached from it, no cycle, links leaving
 * by a real exit, required settings filled. `connectionOk` tells whether a chosen connection is usable.
 */
export function validateGraph(graph: WfGraph, connectionOk: (nodeType: string, connectionId: string) => boolean = () => true): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const triggers = graph.nodes.filter((n) => nodeDef(n.type)?.category === "trigger");
  if (graph.nodes.length > WORKFLOW_LIMITS.nodes) issues.push({ node: null, code: "too_many" });
  if (triggers.length === 0) issues.push({ node: null, code: "no_trigger" });
  for (const t of triggers.slice(1)) issues.push({ node: t.id, code: "two_triggers" });

  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      issues.push({ node: ids.has(e.source) ? e.source : null, code: "dangling" });
      continue;
    }
    const source = graph.nodes.find((n) => n.id === e.source)!;
    const target = graph.nodes.find((n) => n.id === e.target)!;
    if (!nodeDef(source.type)?.handles.includes(e.handle)) issues.push({ node: source.id, code: "bad_handle" });
    if (nodeDef(target.type)?.category === "trigger") issues.push({ node: target.id, code: "into_trigger" });
  }

  for (const n of graph.nodes) {
    const def = nodeDef(n.type);
    if (!def) continue;
    if (def.status === "soon") issues.push({ node: n.id, code: "soon" });
    for (const f of def.fields) {
      const value = n.config[f.key];
      const empty = value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
      if (f.required && empty) issues.push({ node: n.id, code: "missing_field", field: f.key });
      if (f.kind === "connection" && !empty && !connectionOk(n.type, String(value))) issues.push({ node: n.id, code: "bad_connection", field: f.key });
    }
  }

  if (hasCycle(graph)) issues.push({ node: null, code: "cycle" });
  if (triggers.length > 0) {
    const reached = reachable(graph, triggers[0].id);
    for (const n of graph.nodes) if (!reached.has(n.id) && nodeDef(n.type)?.category !== "trigger") issues.push({ node: n.id, code: "unreachable" });
  }
  return issues;
}

export function reachable(graph: WfGraph, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of graph.edges) if (e.source === id && !seen.has(e.target)) {
      seen.add(e.target);
      queue.push(e.target);
    }
  }
  return seen;
}

function hasCycle(graph: WfGraph): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const e of graph.edges) if (e.source === id && visit(e.target)) return true;
    state.set(id, 2);
    return false;
  };
  return graph.nodes.some((n) => visit(n.id));
}

/** What turning the workflow on may do without asking again (the warning before Play). */
export function sensitivities(graph: WfGraph): Sensitivity[] {
  return [...new Set(graph.nodes.map((n) => nodeDef(n.type)?.sensitivity).filter((s): s is Sensitivity => Boolean(s)))];
}

// ─── Variables: {{trigger.subject}}, {{steps.n2.text}}, {{vars.client}}, {{loop.item}} ───────────

export type RunScope = { trigger: unknown; steps: Record<string, unknown>; vars: Record<string, unknown>; loop?: { item: unknown; index: number } };

export function lookup(scope: RunScope, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let value: unknown = scope;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
    else if (typeof value === "object") value = (value as Record<string, unknown>)[part];
    else return undefined;
  }
  return value;
}

const asText = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

/** Fills a text's {{variables}}. A text that is exactly one variable keeps its value (a list stays a list). */
export function fill(template: unknown, scope: RunScope): unknown {
  if (typeof template !== "string") return template;
  const whole = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/.exec(template);
  if (whole) return lookup(scope, whole[1]);
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => asText(lookup(scope, path)));
}

export function fillText(template: unknown, scope: RunScope): string {
  return asText(fill(template, scope));
}

/** The variables a text uses (to show and check them in the editor). */
export function variablesIn(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
}

export function compare(left: unknown, operator: string, right: unknown): boolean {
  const l = asText(left).trim();
  const r = asText(right).trim();
  const num = (s: string) => Number(s.replace(",", "."));
  switch (operator) {
    case "equals":
      return l.toLowerCase() === r.toLowerCase();
    case "not_equals":
      return l.toLowerCase() !== r.toLowerCase();
    case "contains":
      return l.toLowerCase().includes(r.toLowerCase());
    case "not_contains":
      return !l.toLowerCase().includes(r.toLowerCase());
    case "is_empty":
      return l === "" || l === "[]" || l === "{}";
    case "not_empty":
      return !(l === "" || l === "[]" || l === "{}");
    case "greater":
      return Number.isFinite(num(l)) && Number.isFinite(num(r)) && num(l) > num(r);
    case "less":
      return Number.isFinite(num(l)) && Number.isFinite(num(r)) && num(l) < num(r);
    default:
      return false;
  }
}

// ─── Schedule: the next time a scheduled trigger is due (in the company's time zone) ───────────────

/** Minutes east of UTC for a zone at a moment (Intl, no library). */
function zoneOffset(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function nextRun(config: Record<string, unknown>, after: Date, timeZone = "Europe/Paris"): Date {
  const frequency = String(config.frequency ?? "daily");
  if (frequency === "hourly") {
    const next = new Date(after);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }
  const [hh, mm] = String(config.time ?? "08:00").split(":").map((v) => Number(v) || 0);
  const weekday = Number(config.weekday ?? 1);
  for (let d = 0; d <= 8; d++) {
    const offset = zoneOffset(after, timeZone);
    const local = new Date(after.getTime() + offset * 60_000);
    const candidateLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d, hh, mm);
    const candidate = new Date(candidateLocal - zoneOffset(new Date(candidateLocal), timeZone) * 60_000);
    const day = new Date(candidateLocal).getUTCDay();
    if (candidate <= after) continue;
    if (frequency === "weekdays" && (day === 0 || day === 6)) continue;
    if (frequency === "weekly" && day !== weekday) continue;
    return candidate;
  }
  return new Date(after.getTime() + 86_400_000);
}
