import { z } from "zod";
import type { WfGraph, WfNode } from "./graph";
import { nodeDef } from "./nodes";

/**
 * The changes the copilot may make to a workflow (CLAUDE.md §12: "it really modifies the workflow"). The
 * model proposes them as data; they are checked here (known node types, existing ids, allowed settings)
 * and applied to a copy, so the editor can show, apply and undo them like any edit.
 */

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), id: z.string().regex(/^[a-z0-9_-]{1,40}$/i).optional(), type: z.string().max(60), config: z.record(z.string(), z.unknown()).default({}), after: z.string().max(40).optional(), handle: z.string().max(10).optional() }),
  z.object({ op: z.literal("update_node"), id: z.string().max(40), config: z.record(z.string(), z.unknown()).default({}), type: z.string().max(60).optional() }),
  z.object({ op: z.literal("remove_node"), id: z.string().max(40) }),
  z.object({ op: z.literal("connect"), source: z.string().max(40), target: z.string().max(40), handle: z.string().max(10).default("out") }),
  z.object({ op: z.literal("disconnect"), source: z.string().max(40), target: z.string().max(40) }),
]);
export type GraphOp = z.infer<typeof opSchema>;

const allowedConfig = (type: string, config: Record<string, unknown>) => {
  const def = nodeDef(type);
  const keys = new Set([...(def?.fields.map((f) => f.key) ?? []), "continue_on_error", "label"]);
  return Object.fromEntries(Object.entries(config).filter(([k]) => keys.has(k)));
};

function freshId(graph: WfGraph): string {
  let i = graph.nodes.length + 1;
  while (graph.nodes.some((n) => n.id === `n${i}`)) i++;
  return `n${i}`;
}

/** Applies the changes that are valid; the others are reported (and the graph stays as it was for them). */
export function applyOps(graph: WfGraph, ops: GraphOp[]): { graph: WfGraph; applied: number; rejected: number } {
  const g: WfGraph = { nodes: graph.nodes.map((n) => ({ ...n, config: { ...n.config } })), edges: graph.edges.map((e) => ({ ...e })) };
  let applied = 0;
  let rejected = 0;
  const has = (id: string) => g.nodes.some((n) => n.id === id);
  for (const op of ops) {
    switch (op.op) {
      case "add_node": {
        const def = nodeDef(op.type);
        if (!def || def.status !== "available" || (def.category === "trigger" && g.nodes.some((n) => nodeDef(n.type)?.category === "trigger"))) {
          rejected++;
          break;
        }
        const id = op.id && !has(op.id) ? op.id : freshId(g);
        const after = op.after && has(op.after) ? g.nodes.find((n) => n.id === op.after)! : null;
        const position = after ? { x: after.position.x + (op.handle === "false" ? 300 : 0), y: after.position.y + 140 } : { x: 0, y: Math.max(0, ...g.nodes.map((n) => n.position.y)) + 140 };
        const node: WfNode = { id, type: op.type, position, config: allowedConfig(op.type, op.config) };
        g.nodes.push(node);
        if (after) {
          const handle = op.handle && nodeDef(after.type)?.handles.includes(op.handle) ? op.handle : (nodeDef(after.type)?.handles[0] ?? "out");
          // Inserted between `after` and what followed it on that exit.
          for (const e of g.edges.filter((x) => x.source === after.id && x.handle === handle)) {
            e.source = id;
            e.handle = def.handles[0];
          }
          g.edges.push({ id: `e-${after.id}-${id}`, source: after.id, target: id, handle });
        }
        applied++;
        break;
      }
      case "update_node": {
        const node = g.nodes.find((n) => n.id === op.id);
        const type = op.type ?? node?.type;
        if (!node || !type || !nodeDef(type) || nodeDef(type)!.status !== "available" || nodeDef(type)!.category !== nodeDef(node.type)?.category) {
          rejected++;
          break;
        }
        node.type = type;
        node.config = allowedConfig(type, { ...node.config, ...op.config });
        applied++;
        break;
      }
      case "remove_node": {
        const node = g.nodes.find((n) => n.id === op.id);
        if (!node || nodeDef(node.type)?.category === "trigger") {
          rejected++;
          break;
        }
        const incoming = g.edges.filter((e) => e.target === op.id);
        const outgoing = g.edges.filter((e) => e.source === op.id);
        g.nodes = g.nodes.filter((n) => n.id !== op.id);
        g.edges = g.edges.filter((e) => e.source !== op.id && e.target !== op.id);
        // A node in the middle of a chain: its neighbours are joined again.
        if (incoming.length === 1 && outgoing.length === 1) g.edges.push({ id: `e-${incoming[0].source}-${outgoing[0].target}`, source: incoming[0].source, target: outgoing[0].target, handle: incoming[0].handle });
        applied++;
        break;
      }
      case "connect": {
        const source = g.nodes.find((n) => n.id === op.source);
        if (!source || !has(op.target) || !nodeDef(source.type)?.handles.includes(op.handle) || g.edges.some((e) => e.source === op.source && e.target === op.target)) {
          rejected++;
          break;
        }
        g.edges.push({ id: `e-${op.source}-${op.target}-${op.handle}`, source: op.source, target: op.target, handle: op.handle });
        applied++;
        break;
      }
      case "disconnect": {
        const before = g.edges.length;
        g.edges = g.edges.filter((e) => !(e.source === op.source && e.target === op.target));
        if (g.edges.length === before) rejected++;
        else applied++;
        break;
      }
    }
  }
  return { graph: g, applied, rejected };
}

/** Whether the changes add or modify an action that writes outside (shown for confirmation first). */
export function opsAreSensitive(graph: WfGraph, ops: GraphOp[]): boolean {
  return ops.some((op) => {
    const type = op.op === "add_node" ? op.type : op.op === "update_node" ? (op.type ?? graph.nodes.find((n) => n.id === op.id)?.type) : null;
    return Boolean(type && nodeDef(type)?.sensitivity);
  });
}

/** What the copilot is shown of the workflow: types, links and short settings; no secret, no run data. */
export function compactGraph(graph: WfGraph): { nodes: { id: string; type: string; config: Record<string, unknown> }[]; edges: { from: string; to: string; exit: string }[] } {
  const short = (v: unknown) => (typeof v === "string" && v.length > 240 ? `${v.slice(0, 240)}…` : v);
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, config: Object.fromEntries(Object.entries(n.config).map(([k, v]) => [k, short(v)])) })),
    edges: graph.edges.map((e) => ({ from: e.source, to: e.target, exit: e.handle })),
  };
}
