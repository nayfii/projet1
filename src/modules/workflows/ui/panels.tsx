"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FlaskConicalIcon, LoaderIcon, SearchIcon, SendIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ComingSoon } from "@/components/ui/coming-soon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WfGraph } from "../graph";
import { CATEGORIES, NODES, nodeDef } from "../nodes";
import type { GraphOp } from "../ops";
import { copilotAction } from "../server/copilot";
import { getRunAction, runWorkflowAction, type RunView } from "../server/actions";
import type { EditorContext } from "./settings-panel";
import { nodeKey } from "./step-node";

export const DRAG_TYPE = "application/x-cendr-node";

/** Left: the node library, by family; app nodes only when a suitable app is connected. */
export function Library({ context, onAdd, readOnly }: { context: EditorContext; onAdd: (type: string) => void; readOnly: boolean }) {
  const t = useTranslations("workflows");
  const [query, setQuery] = React.useState("");
  const apps = new Set(context.connections.flatMap((c) => c.apps));
  const q = query.trim().toLowerCase();
  return (
    <div className="flex h-full flex-col gap-3" data-testid="node-library">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchNodes")} aria-label={t("searchNodes")} className="h-8 pl-8 text-[13px]" />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {CATEGORIES.map((category) => {
          const items = NODES.filter((n) => n.category === category && t(`node.${nodeKey(n.type)}` as "node.trigger_manual").toLowerCase().includes(q));
          if (items.length === 0) return null;
          return (
            <div key={category} className="space-y-1">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t(`category.${category}`)}</p>
              {items.map((n) => {
                const needsApp = n.fields.find((f) => f.kind === "connection")?.apps;
                const missingApp = needsApp && !needsApp.some((a) => apps.has(a));
                const disabled = readOnly || n.status === "soon";
                return (
                  <button
                    key={n.type}
                    type="button"
                    disabled={disabled}
                    draggable={!disabled}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, n.type);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onAdd(n.type)}
                    title={missingApp ? t("needsApp") : t(`desc.${nodeKey(n.type)}` as "desc.trigger_manual")}
                    className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent disabled:opacity-50", missingApp ? "text-muted-foreground" : "")}
                  >
                    <span className="min-w-0 flex-1 truncate">{t(`node.${nodeKey(n.type)}` as "node.trigger_manual")}</span>
                    {n.status === "soon" ? <ComingSoon className="text-[10px]" /> : missingApp ? <span className="text-[10px]">{t("toConnect")}</span> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Message = { role: "user" | "assistant"; text: string; pending?: { ops: GraphOp[]; graph: WfGraph } };

/** Right: Cendr AI, which really edits the workflow (sensitive changes are shown first). */
export function CopilotPanel({ workflowId, graph, readOnly, onApply }: { workflowId: string; graph: WfGraph; readOnly: boolean; onApply: (graph: WfGraph, label: string) => void }) {
  const t = useTranslations("workflows");
  const tErrors = useTranslations("errors");
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const examples = [t("copilotExample1"), t("copilotExample2"), t("copilotExample3")];

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const history = messages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    const result = await copilotAction({ workflowId, graph, message: text, history });
    setBusy(false);
    if (!result.ok) {
      setMessages((m) => [...m, { role: "assistant", text: t.has(`batchError.${result.error}` as "batchError.provider_error") ? t(`batchError.${result.error}` as "batchError.provider_error") : tErrors(result.error as "unknown") }]);
      return;
    }
    const data = result.data!;
    const reply = data.reply || t("copilotDone");
    if (data.applied > 0 && data.sensitive) {
      setMessages((m) => [...m, { role: "assistant", text: reply, pending: { ops: data.ops, graph: data.graph } }]);
    } else {
      if (data.applied > 0) onApply(data.graph, t("copilotApplied"));
      setMessages((m) => [...m, { role: "assistant", text: data.rejected > 0 ? `${reply} ${t("copilotRejected", { count: data.rejected })}` : reply }]);
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="copilot">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="space-y-2 text-[13px] text-muted-foreground">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <SparklesIcon className="size-4" />
              {t("copilotIntro")}
            </p>
            {examples.map((e) => (
              <button key={e} type="button" disabled={readOnly} onClick={() => void send(e)} className="block w-full rounded-lg border px-3 py-2 text-left hover:bg-accent disabled:opacity-50">
                {e}
              </button>
            ))}
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={cn("rounded-xl px-3 py-2 text-[13px]", m.role === "user" ? "ml-6 bg-muted" : "mr-6 border")}>
            {m.text}
            {m.pending ? (
              <div className="mt-2 space-y-2 border-t pt-2">
                <p className="text-xs text-muted-foreground">{t("copilotPreview", { count: m.pending.ops.length })}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      onApply(m.pending!.graph, t("copilotApplied"));
                      setMessages((list) => list.map((x, j) => (j === i ? { ...x, pending: undefined, text: `${x.text} ✓` } : x)));
                    }}
                  >
                    {t("copilotApply")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMessages((list) => list.map((x, j) => (j === i ? { ...x, pending: undefined } : x)))}>
                    {t("copilotIgnore")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {busy ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderIcon className="size-3.5 animate-spin" />
            {t("copilotThinking")}
          </p>
        ) : null}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("copilotPlaceholder")} aria-label={t("copilotPlaceholder")} disabled={readOnly} />
        <Button type="submit" size="icon" disabled={readOnly || busy || !draft.trim()} aria-label={t("send")}>
          <SendIcon />
        </Button>
      </form>
    </div>
  );
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** Right: test with sample data (actions are only shown), follow a run step by step, see past runs. */
export function RunsPanel({ workflowId, graph, active, runs, onRun, beforeRun }: { workflowId: string; graph: WfGraph; active: boolean; runs: { id: string; mode: string; status: string; createdAt: string }[]; onRun: (run: RunView | null) => void; beforeRun: () => Promise<boolean> }) {
  const t = useTranslations("workflows");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const sample = String(graph.nodes.find((n) => n.type === "trigger.manual")?.config.sample ?? "");
  const [input, setInput] = React.useState(sample);
  const [run, setRun] = React.useState<RunView | null>(null);
  const [starting, setStarting] = React.useState(false);

  React.useEffect(() => {
    if (!run || TERMINAL.has(run.status)) return;
    const timer = setInterval(async () => {
      const next = await getRunAction({ runId: run.id });
      if (next.ok) {
        setRun(next.data!);
        onRun(next.data!);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [run, onRun]);

  const start = async (mode: "test" | "live", runId?: string) => {
    setStarting(true);
    // A test runs the draft as saved: unsaved changes are saved first.
    if (!runId && !(await beforeRun())) {
      setStarting(false);
      return;
    }
    const result = runId ? { ok: true as const, data: { runId } } : await runWorkflowAction({ id: workflowId, mode, data: input });
    setStarting(false);
    if (!result.ok) {
      toast.error(tErrors(result.error));
      return;
    }
    const first = await getRunAction({ runId: result.data!.runId });
    if (first.ok) {
      setRun(first.data!);
      onRun(first.data!);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1" data-testid="runs-panel">
      <div className="space-y-2">
        <label htmlFor="test-input" className="text-xs font-medium">
          {t("testInput")}
        </label>
        <textarea id="test-input" value={input} onChange={(e) => setInput(e.target.value)} rows={4} className="w-full rounded-md border bg-transparent px-3 py-2 text-[13px] outline-none focus-visible:border-ring" />
        <p className="text-[11.5px] text-muted-foreground">{t("testHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void start("test")} disabled={starting}>
            <FlaskConicalIcon />
            {t("runTest")}
          </Button>
          {active ? (
            <Button size="sm" variant="outline" onClick={() => void start("live")} disabled={starting}>
              {t("runNow")}
            </Button>
          ) : null}
        </div>
      </div>

      {run ? (
        <div className="space-y-2 rounded-xl border p-3" data-testid="run-detail">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            {run.mode === "test" ? t("testRun") : t("liveRun")}
            <Badge variant="outline">{t(`runStatus.${run.status as "succeeded"}`)}</Badge>
          </p>
          {run.errorCode ? <p className="text-xs text-destructive">{t.has(`runError.${run.errorCode}` as "runError.provider_error") ? t(`runError.${run.errorCode}` as "runError.provider_error") : run.errorCode}</p> : null}
          <ol className="space-y-1.5">
            {run.steps.map((s) => (
              <li key={`${s.nodeId}-${s.iteration}`} className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {s.nodeId} · {t(`node.${nodeKey(s.nodeType)}` as "node.trigger_manual")}
                    {s.iteration ? ` #${s.iteration}` : ""}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {t(`stepStatus.${s.status as "succeeded"}`)}
                    {s.durationMs !== null ? ` · ${s.durationMs} ms` : ""}
                  </span>
                </span>
                {s.errorCode ? <span className="block text-destructive">{t.has(`runError.${s.errorCode}` as "runError.provider_error") ? t(`runError.${s.errorCode}` as "runError.provider_error") : s.errorCode}</span> : null}
                {s.output !== null && s.output !== undefined && nodeDef(s.nodeType)?.category !== "trigger" ? (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] text-muted-foreground">{JSON.stringify(s.output, null, 2).slice(0, 2000)}</pre>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t("history")}</p>
          <ul className="divide-y rounded-lg border text-xs">
            {runs.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => void start("test", r.id)} className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-accent">
                  <span>
                    {r.mode === "test" ? t("testRun") : t("liveRun")} · {format.relativeTime(new Date(r.createdAt))}
                  </span>
                  <span className="text-muted-foreground">{t(`runStatus.${r.status as "succeeded"}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
