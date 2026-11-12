"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CopyIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { memoryLabel } from "@/modules/memory/labels";
import type { MemoryKind } from "@/modules/memory/types";
import { type GraphIssue, type WfGraph, type WfNode } from "../graph";
import { nodeDef, type FieldDef } from "../nodes";
import { nodeKey } from "./step-node";

export type EditorContext = {
  connections: { id: string; provider: string; apps: string[]; label: string | null }[];
  spaces: { id: string; kind: MemoryKind; name: string | null }[];
  workflows: { id: string; name: string }[];
  models: { id: string; label: string; available: boolean }[];
};

/** The main output of each node type, offered as variables to the steps that follow. */
const OUTPUTS: Record<string, string[]> = {
  "ai.generate": ["text"],
  "ai.summarize": ["text"],
  "ai.classify": ["label"],
  "ai.decide": ["answer", "reason"],
  "ai.memory": ["text", "count"],
  "app.search_email": ["text", "items", "count"],
  "app.search_files": ["items", "first"],
  "app.read_file": ["text", "name"],
  "app.calendar_events": ["text", "items"],
  "logic.transform": ["text"],
  "logic.set": ["value"],
};

const TRIGGER_FIELDS: Record<string, string[]> = {
  "trigger.manual": ["text"],
  "trigger.schedule": ["scheduled_at"],
  "trigger.email": ["from", "subject", "snippet", "date"],
  "trigger.webhook": ["…"],
};

/** Variables available to a node: the trigger's fields and the outputs of the steps before it. */
function variablesFor(graph: WfGraph, nodeId: string): string[] {
  const before = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of graph.edges) if (e.target === id && !before.has(e.source)) {
      before.add(e.source);
      queue.push(e.source);
    }
  }
  const out: string[] = [];
  for (const n of graph.nodes) {
    if (!before.has(n.id)) continue;
    if (n.type.startsWith("trigger.")) out.push(...(TRIGGER_FIELDS[n.type] ?? []).map((f) => `{{trigger.${f}}}`));
    else if (n.type === "ai.extract") out.push(...(Array.isArray(n.config.fields) ? n.config.fields : []).map((f) => `{{steps.${n.id}.${String(f)}}}`));
    else if (n.type === "logic.loop") out.push("{{loop.item}}", "{{loop.index}}");
    else out.push(...(OUTPUTS[n.type] ?? []).map((f) => `{{steps.${n.id}.${f}}}`));
    if (n.type === "logic.set" && typeof n.config.name === "string" && n.config.name) out.push(`{{vars.${n.config.name}}}`);
  }
  return out;
}

export function SettingsPanel({ graph, node, context, issues, readOnly, onChange, onRemove, onDuplicate }: { graph: WfGraph; node: WfNode; context: EditorContext; issues: GraphIssue[]; readOnly: boolean; onChange: (config: Record<string, unknown>) => void; onRemove: () => void; onDuplicate: () => void }) {
  const t = useTranslations("workflows");
  const tMemory = useTranslations("memory");
  const def = nodeDef(node.type);
  const vars = React.useMemo(() => variablesFor(graph, node.id), [graph, node.id]);
  const [focused, setFocused] = React.useState<string | null>(null);
  if (!def) return null;
  const set = (key: string, value: unknown) => onChange({ ...node.config, [key]: value });
  const missing = new Set(issues.filter((i) => i.node === node.id && (i.code === "missing_field" || i.code === "bad_connection")).map((i) => i.field));

  const field = (f: FieldDef) => {
    const id = `field-${node.id}-${f.key}`;
    const value = node.config[f.key];
    const label = t(`field.${f.key}` as "field.prompt");
    const common = { id, disabled: readOnly, onFocus: () => setFocused(f.key), "aria-invalid": missing.has(f.key) || undefined };
    let control: React.ReactNode;
    switch (f.kind) {
      case "textarea":
        control = <textarea {...common} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)} rows={4} className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring aria-[invalid=true]:border-warning" />;
        break;
      case "number":
        control = <Input {...common} type="number" min={f.min} max={f.max} value={value === undefined ? "" : String(value)} onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))} />;
        break;
      case "time":
        control = <Input {...common} type="time" value={String(value ?? "08:00")} onChange={(e) => set(f.key, e.target.value)} />;
        break;
      case "list":
        control = <Input {...common} value={Array.isArray(value) ? value.join(", ") : String(value ?? "")} onChange={(e) => set(f.key, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />;
        break;
      case "select":
        control = (
          <select {...common} value={String(value ?? f.options?.[0] ?? "")} onChange={(e) => set(f.key, e.target.value)} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {f.key === "weekday" ? t(`weekday.${o}` as "weekday.1") : t(`option.${o}` as "option.daily")}
              </option>
            ))}
          </select>
        );
        break;
      case "connection": {
        const usable = context.connections.filter((c) => c.apps.some((a) => f.apps?.includes(a)));
        control =
          usable.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {t("noConnection")}{" "}
              <Link href="/integrations" className="underline">
                {t("connectIn")}
              </Link>
            </p>
          ) : (
            <select {...common} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm aria-[invalid=true]:border-warning">
              <option value="">{t("choose")}</option>
              {usable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? c.provider} · {c.apps.filter((a) => f.apps?.includes(a)).join(", ")}
                </option>
              ))}
            </select>
          );
        break;
      }
      case "model":
        control = (
          <select {...common} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value || undefined)} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
            <option value="">{t("modelDefault")}</option>
            {context.models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.label}
              </option>
            ))}
          </select>
        );
        break;
      case "space":
        control = (
          <select {...common} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm aria-[invalid=true]:border-warning">
            <option value="">{t("choose")}</option>
            {context.spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.kind === "client" ? tMemory("clientMemoryNamed", { client: s.name ?? "" }) : memoryLabel(s.kind, s.name, tMemory)}
              </option>
            ))}
          </select>
        );
        break;
      case "workflow":
        control = (
          <select {...common} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
            <option value="">{t("choose")}</option>
            {context.workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        );
        break;
      default:
        control = <Input {...common} value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)} />;
    }
    return (
      <div key={f.key} className="space-y-1.5">
        <Label htmlFor={id} className="text-xs">
          {label}
          {f.required ? <span className="text-muted-foreground">{" *"}</span> : null}
        </Label>
        {control}
        {f.template && focused === f.key && vars.length > 0 && !readOnly ? (
          <div className="flex flex-wrap gap-1" aria-label={t("variables")}>
            {vars.slice(0, 12).map((v) => (
              <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => set(f.key, `${String(node.config[f.key] ?? "")}${v}`)} className="rounded border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
                {v}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="settings-panel">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t(`category.${def.category}`)}</p>
        <h3 className="text-sm font-semibold">{t(`node.${nodeKey(node.type)}` as "node.trigger_manual")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t(`desc.${nodeKey(node.type)}` as "desc.trigger_manual")}</p>
      </div>
      {def.fields.map(field)}
      {def.canContinue ? (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" disabled={readOnly} checked={node.config.continue_on_error === true} onChange={(e) => set("continue_on_error", e.target.checked)} className="mt-0.5" />
          <span>{t("continueOnError")}</span>
        </label>
      ) : null}
      {def.sensitivity ? <p className="rounded-md bg-warning-soft px-3 py-2 text-xs">{t(`sensitivity.${def.sensitivity}`)}</p> : null}
      {!readOnly ? (
        <div className="flex gap-2 border-t pt-3">
          <Button size="sm" variant="ghost" onClick={onDuplicate} disabled={def.category === "trigger"}>
            <CopyIcon />
            {t("duplicate")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove} disabled={def.category === "trigger"}>
            <Trash2Icon />
            {t("remove")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
