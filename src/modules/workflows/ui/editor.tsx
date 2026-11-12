"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeftIcon, CircleAlertIcon, LayoutListIcon, PanelLeftIcon, PanelRightIcon, PauseIcon, PlayIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { validateGraph, type GraphIssue, type WfGraph, type WfNode } from "../graph";
import { nodeDef, type Sensitivity } from "../nodes";
import { pauseWorkflowAction, playWorkflowAction, rotateWebhookAction, saveDraftAction, type RunView } from "../server/actions";
import { CopilotPanel, DRAG_TYPE, Library, RunsPanel } from "./panels";
import { SettingsPanel, type EditorContext } from "./settings-panel";
import { StepNode, type StepData } from "./step-node";

const NODE_TYPES = { step: StepNode };

export type EditorWorkflow = {
  id: string;
  name: string;
  status: "active" | "paused";
  graph: WfGraph;
  revision: number;
  activeVersion: number | null;
  runs: { id: string; mode: string; status: string; createdAt: string }[];
  hasWebhookSecret: boolean;
};

/** Top-to-bottom layers from the trigger ("Organiser"). */
function layout(graph: WfGraph): WfGraph {
  const trigger = graph.nodes.find((n) => nodeDef(n.type)?.category === "trigger");
  if (!trigger) return graph;
  const depth = new Map<string, number>([[trigger.id, 0]]);
  const queue = [trigger.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of graph.edges) if (e.source === id && !depth.has(e.target)) {
      depth.set(e.target, depth.get(id)! + 1);
      queue.push(e.target);
    }
  }
  const rows = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const d = depth.get(n.id) ?? Math.max(0, ...depth.values()) + 1;
    rows.set(d, [...(rows.get(d) ?? []), n.id]);
  }
  return { ...graph, nodes: graph.nodes.map((n) => {
    const d = depth.get(n.id) ?? Math.max(0, ...depth.values()) + 1;
    const row = rows.get(d)!;
    const i = row.indexOf(n.id);
    return { ...n, position: { x: (i - (row.length - 1) / 2) * 290, y: d * 150 } };
  }) };
}

function newId(graph: WfGraph): string {
  let i = graph.nodes.length + 1;
  while (graph.nodes.some((n) => n.id === `n${i}`)) i++;
  return `n${i}`;
}

export function WorkflowEditor(props: { workflow: EditorWorkflow; context: EditorContext; canEdit: boolean }) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ workflow, context, canEdit }: { workflow: EditorWorkflow; context: EditorContext; canEdit: boolean }) {
  const t = useTranslations("workflows");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const flow = useReactFlow();
  const [graph, setGraph] = React.useState<WfGraph>(workflow.graph);
  const [name, setName] = React.useState(workflow.name);
  const [past, setPast] = React.useState<WfGraph[]>([]);
  const [future, setFuture] = React.useState<WfGraph[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"copilot" | "settings" | "runs">("copilot");
  const [left, setLeft] = React.useState(true);
  const [right, setRight] = React.useState(true);
  const [save, setSave] = React.useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [run, setRun] = React.useState<RunView | null>(null);
  const [confirm, setConfirm] = React.useState<Sensitivity[] | null>(null);
  const [webhook, setWebhook] = React.useState<string | null>(null);
  const [showIssues, setShowIssues] = React.useState(false);
  const [serverIssues, setServerIssues] = React.useState<GraphIssue[]>([]);
  const [pending, start] = React.useTransition();
  const revision = React.useRef(workflow.revision);
  const first = React.useRef(true);
  const readOnly = !canEdit;

  // Commit = a change that can be undone; set = a change in progress (a drag).
  const commit = React.useCallback((next: WfGraph) => {
    setGraph((current) => {
      setPast((p) => [...p.slice(-49), current]);
      setFuture([]);
      return next;
    });
  }, []);
  const undo = React.useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      setGraph((current) => {
        setFuture((f) => [current, ...f]);
        return p[p.length - 1];
      });
      return p.slice(0, -1);
    });
  }, []);
  const redo = React.useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      setGraph((current) => {
        setPast((p) => [...p, current]);
        return f[0];
      });
      return f.slice(1);
    });
  }, []);

  // Autosave of the draft (the active version only changes with Play). `flush` saves at once (before Play or a test).
  const latest = React.useRef({ graph, name });
  const dirty = React.useRef(false);
  const saveNow = React.useCallback(async () => {
    if (!dirty.current || readOnly) return true;
    dirty.current = false;
    setSave("saving");
    const result = await saveDraftAction({ id: workflow.id, graph: latest.current.graph, revision: revision.current, name: latest.current.name });
    if (result.ok) {
      revision.current = result.data!.revision;
      setSave("saved");
      return true;
    }
    setSave(result.error === "conflict" ? "conflict" : "error");
    return false;
  }, [workflow.id, readOnly]);
  React.useEffect(() => {
    latest.current = { graph, name };
    if (first.current) {
      first.current = false;
      return;
    }
    if (readOnly) return;
    dirty.current = true;
    const timer = setTimeout(() => void saveNow(), 800);
    return () => clearTimeout(timer);
  }, [graph, name, readOnly, saveNow]);

  const connectionOk = React.useCallback(
    (type: string, id: string) => {
      const apps = context.connections.find((c) => c.id === id)?.apps ?? [];
      return Object.keys(nodeDef(type)?.capabilities ?? {}).some((a) => apps.includes(a));
    },
    [context.connections],
  );
  // What the editor sees, plus what our server found at the last Play (e.g. a connection the author lost).
  const issues = React.useMemo(() => {
    const local = validateGraph(graph, connectionOk);
    const extra = serverIssues.filter((i) => !local.some((l) => l.node === i.node && l.code === i.code && l.field === i.field) && (!i.node || graph.nodes.some((n) => n.id === i.node)));
    return [...local, ...extra];
  }, [graph, connectionOk, serverIssues]);
  const stepStatus = React.useMemo(() => new Map((run?.steps ?? []).map((s) => [s.nodeId, s.status])), [run]);

  const nodes: Node[] = React.useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "step",
        position: n.position,
        selected: n.id === selected,
        data: { type: n.type, config: n.config, issues: issues.filter((i) => i.node === n.id).length, run: stepStatus.get(n.id) } satisfies StepData as unknown as Record<string, unknown>,
        deletable: !readOnly && nodeDef(n.type)?.category !== "trigger",
      })),
    [graph.nodes, selected, issues, stepStatus, readOnly],
  );
  const edges: Edge[] = React.useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.handle, label: e.handle === "out" ? undefined : t(`handle.${e.handle}` as "handle.true"), deletable: !readOnly })),
    [graph.edges, readOnly, t],
  );

  const onNodesChange = (changes: NodeChange[]) => {
    let next = graph;
    let done = false;
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        next = { ...next, nodes: next.nodes.map((n) => (n.id === c.id ? { ...n, position: c.position! } : n)) };
        if (!c.dragging) done = true;
      } else if (c.type === "select" && c.selected) {
        setSelected(c.id);
        setTab("settings");
        setRight(true);
      } else if (c.type === "remove" && !readOnly) {
        next = { nodes: next.nodes.filter((n) => n.id !== c.id), edges: next.edges.filter((e) => e.source !== c.id && e.target !== c.id) };
        done = true;
        if (selected === c.id) setSelected(null);
      }
    }
    if (next === graph) return;
    if (done) commit(next);
    else setGraph(next);
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (removed.length && !readOnly) commit({ ...graph, edges: graph.edges.filter((e) => !removed.includes(e.id)) });
  };
  const onConnect = (c: Connection) => {
    if (readOnly || !c.source || !c.target || c.source === c.target) return;
    const target = graph.nodes.find((n) => n.id === c.target);
    if (nodeDef(target?.type ?? "")?.category === "trigger") return;
    const handle = c.sourceHandle ?? "out";
    if (graph.edges.some((e) => e.source === c.source && e.target === c.target && e.handle === handle)) return;
    commit({ ...graph, edges: [...graph.edges, { id: `e-${c.source}-${c.target}-${handle}-${Date.now().toString(36)}`, source: c.source, target: c.target, handle }] });
  };

  const addNode = (type: string, position?: { x: number; y: number }) => {
    const def = nodeDef(type);
    if (readOnly || !def || def.status !== "available") return;
    if (def.category === "trigger" && graph.nodes.some((n) => nodeDef(n.type)?.category === "trigger")) {
      toast.error(t("oneTrigger"));
      return;
    }
    const id = newId(graph);
    const after = graph.nodes.find((n) => n.id === selected) ?? [...graph.nodes].sort((a, b) => b.position.y - a.position.y)[0];
    const node: WfNode = { id, type, position: position ?? { x: after?.position.x ?? 0, y: (after?.position.y ?? -150) + 150 }, config: {} };
    const edgesNext = after && !position && def.category !== "trigger" ? [...graph.edges, { id: `e-${after.id}-${id}`, source: after.id, target: id, handle: nodeDef(after.type)?.handles[0] ?? "out" }] : graph.edges;
    commit({ nodes: [...graph.nodes, node], edges: edgesNext });
    setSelected(id);
    setTab("settings");
  };

  const duplicate = () => {
    const node = graph.nodes.find((n) => n.id === selected);
    if (!node || readOnly || nodeDef(node.type)?.category === "trigger") return;
    const id = newId(graph);
    commit({ ...graph, nodes: [...graph.nodes, { ...node, id, position: { x: node.position.x + 40, y: node.position.y + 40 }, config: { ...node.config } }] });
    setSelected(id);
  };

  // Keyboard: undo / redo, duplicate.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const play = (confirmed = false) =>
    start(async () => {
      if (!(await saveNow())) return;
      const result = await playWorkflowAction({ id: workflow.id, confirmed });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      const data = result.data!;
      if (data.status === "confirm") setConfirm(data.sensitivities);
      else if (data.status === "invalid") {
        setServerIssues(data.issues);
        setShowIssues(true);
        toast.error(t("cannotPlay"));
      } else {
        setServerIssues([]);
        setConfirm(null);
        toast.success(t("activated"));
        if (data.webhookSecret) setWebhook(data.webhookSecret);
        router.refresh();
      }
    });
  const pause = () =>
    start(async () => {
      const result = await pauseWorkflowAction({ id: workflow.id });
      if (!result.ok) toast.error(tErrors(result.error));
      else {
        toast.success(t("paused", { count: result.data!.cancelled }));
        router.refresh();
      }
    });

  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const issueText = (i: GraphIssue) => `${i.node ? `${i.node} · ` : ""}${t(`issue.${i.code}`)}${i.field ? ` (${t(`field.${i.field}` as "field.prompt")})` : ""}`;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-dvh" data-testid="workflow-editor">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon-sm" aria-label={t("back")}>
          <Link href="/workflows">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} aria-label={t("name")} className="h-8 w-56 border-transparent bg-transparent text-sm font-medium hover:border-input" />
        <Badge variant={workflow.status === "active" ? "brand" : "outline"} data-testid="workflow-status">
          {workflow.status === "active" ? t("statusActive") : t("statusPaused")}
        </Badge>
        {workflow.activeVersion ? <span className="hidden text-xs text-muted-foreground md:inline">{t("activeVersion", { version: workflow.activeVersion })}</span> : null}
        <span className={cn("text-xs", save === "conflict" || save === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
          {readOnly ? t("readOnly") : t(`save.${save}`)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setLeft((v) => !v)} aria-label={t("toggleLibrary")}>
            <PanelLeftIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!past.length || readOnly} aria-label={t("undo")}>
            <Undo2Icon />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!future.length || readOnly} aria-label={t("redo")}>
            <Redo2Icon />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => commit(layout(graph))} disabled={readOnly}>
            <LayoutListIcon />
            <span className="hidden sm:inline">{t("arrange")}</span>
          </Button>
          {issues.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowIssues((v) => !v)} className="text-warning">
              <CircleAlertIcon />
              {t("issuesCount", { count: issues.length })}
            </Button>
          ) : null}
          {canEdit ? (
            workflow.status === "active" ? (
              <Button size="sm" variant="outline" onClick={pause} disabled={pending} data-testid="pause">
                <PauseIcon />
                {t("pause")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => play(false)} disabled={pending} data-testid="play">
                <PlayIcon />
                {t("play")}
              </Button>
            )
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={() => setRight((v) => !v)} aria-label={t("togglePanel")}>
            <PanelRightIcon />
          </Button>
        </div>
      </header>
      {showIssues && issues.length > 0 ? (
        <ul className="border-b bg-warning-soft/60 px-4 py-2 text-xs" data-testid="issues">
          {issues.slice(0, 8).map((i, k) => (
            <li key={k}>
              <button type="button" className="hover:underline" onClick={() => i.node && setSelected(i.node)}>
                {issueText(i)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {workflow.status === "active" ? <p className="border-b px-4 py-1.5 text-[11.5px] text-muted-foreground">{t("draftNote")}</p> : null}

      <div className="relative flex min-h-0 flex-1">
        {left ? (
          <aside className="absolute inset-y-0 left-0 z-10 w-60 border-r bg-background p-3 lg:static">
            <Library context={context} readOnly={readOnly} onAdd={(type) => addNode(type)} />
          </aside>
        ) : null}
        <div
          className="min-w-0 flex-1"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
          }}
          onDrop={(e) => {
            const type = e.dataTransfer.getData(DRAG_TYPE);
            if (!type) return;
            e.preventDefault();
            addNode(type, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => setSelected(null)}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            snapToGrid
            snapGrid={[10, 10]}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            colorMode="system"
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            {graph.nodes.length > 8 ? <MiniMap pannable zoomable className="!bg-card" /> : null}
          </ReactFlow>
        </div>
        {right ? (
          <aside className="absolute inset-y-0 right-0 z-10 flex w-[22rem] max-w-full flex-col border-l bg-background lg:static">
            <div className="flex gap-1 border-b p-2" role="tablist">
              {(["copilot", "settings", "runs"] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-md px-2.5 py-1 text-[13px]", tab === k ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}>
                  {t(`tab.${k}`)}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-3">
              {tab === "copilot" ? <CopilotPanel workflowId={workflow.id} graph={graph} readOnly={readOnly} onApply={(next) => commit(next)} /> : null}
              {tab === "settings" ? (
                selectedNode ? (
                  <div className="h-full overflow-y-auto pr-1">
                    <SettingsPanel
                      key={selectedNode.id}
                      graph={graph}
                      node={selectedNode}
                      context={context}
                      issues={issues}
                      readOnly={readOnly}
                      onChange={(config) => commit({ ...graph, nodes: graph.nodes.map((n) => (n.id === selectedNode.id ? { ...n, config } : n)) })}
                      onRemove={() => {
                        commit({ nodes: graph.nodes.filter((n) => n.id !== selectedNode.id), edges: graph.edges.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id) });
                        setSelected(null);
                      }}
                      onDuplicate={duplicate}
                    />
                    {selectedNode.type === "trigger.webhook" && canEdit ? (
                      <div className="mt-4 space-y-2 rounded-lg border p-3 text-xs">
                        <p>{t("webhookHint")}</p>
                        <Button size="sm" variant="outline" onClick={() => start(async () => {
                          const result = await rotateWebhookAction({ id: workflow.id });
                          if (result.ok) setWebhook(result.data!.secret);
                          else toast.error(tErrors(result.error));
                        })}>
                          {workflow.hasWebhookSecret ? t("webhookRotate") : t("webhookCreate")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">{t("selectNode")}</p>
                )
              ) : null}
              {tab === "runs" ? <RunsPanel workflowId={workflow.id} graph={graph} active={workflow.status === "active"} runs={workflow.runs} onRun={setRun} beforeRun={saveNow} /> : null}
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-md" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("confirmBody")}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="play-warnings">
            {(confirm ?? []).map((s) => (
              <li key={s}>{t(`sensitivity.${s}`)}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("confirmNote")}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={() => play(true)} disabled={pending}>
              {t("confirmPlay")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={webhook !== null} onOpenChange={(o) => !o && setWebhook(null)}>
        <DialogContent className="max-w-lg" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{t("webhookTitle")}</DialogTitle>
            <DialogDescription>{t("webhookBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            <p className="font-medium">{t("webhookUrl")}</p>
            <code className="block break-all rounded-md border bg-muted/40 px-2 py-1.5">{typeof window !== "undefined" ? `${window.location.origin}/api/workflows/hooks/${workflow.id}` : ""}</code>
            <p className="font-medium">{t("webhookSecret")}</p>
            <code className="block break-all rounded-md border bg-muted/40 px-2 py-1.5" data-testid="webhook-secret">
              {webhook}
            </code>
          </div>
          <DialogFooter>
            <Button onClick={() => setWebhook(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
