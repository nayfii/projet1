"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useTranslations } from "next-intl";
import { BotIcon, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleXIcon, GitBranchIcon, PlayIcon, PlugIcon, ZapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { nodeDef, type NodeCategory } from "../nodes";

export type StepData = { type: string; config: Record<string, unknown>; issues: number; run?: string };

const ICONS: Record<NodeCategory, React.ComponentType<{ className?: string }>> = { trigger: PlayIcon, ai: BotIcon, apps: PlugIcon, logic: GitBranchIcon, action: ZapIcon };

export const nodeKey = (type: string) => type.replace(".", "_");

/** One step on the canvas: what it is, a hint of its settings, problems and the last test's result. */
export function StepNode({ data, selected }: NodeProps) {
  const t = useTranslations("workflows");
  const d = data as unknown as StepData;
  const def = nodeDef(d.type);
  const Icon = def ? ICONS[def.category] : PlayIcon;
  const summary = summarize(d.config);
  const status = d.run;
  return (
    <div
      className={cn(
        "w-60 rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-colors",
        selected ? "border-foreground/50 ring-2 ring-foreground/10" : "",
        d.issues > 0 ? "border-warning/60" : "",
        status === "failed" ? "border-destructive/60" : "",
      )}
      data-testid={`node-${d.type}`}
    >
      {def?.category !== "trigger" ? <Handle type="target" position={Position.Top} className="!size-2.5 !border-2 !border-background !bg-muted-foreground" /> : null}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{t(`category.${def?.category ?? "logic"}`)}</p>
          <p className="truncate text-[13px] font-medium">{t(`node.${nodeKey(d.type)}` as "node.trigger_manual")}</p>
          {summary ? <p className="truncate text-[11.5px] text-muted-foreground">{summary}</p> : null}
        </div>
        {status === "succeeded" ? <CircleCheckIcon className="size-4 shrink-0 text-success" aria-label={t("stepStatus.succeeded")} /> : null}
        {status === "simulated" ? <CircleDashedIcon className="size-4 shrink-0 text-brand" aria-label={t("stepStatus.simulated")} /> : null}
        {status === "failed" ? <CircleXIcon className="size-4 shrink-0 text-destructive" aria-label={t("stepStatus.failed")} /> : null}
        {!status && d.issues > 0 ? <CircleAlertIcon className="size-4 shrink-0 text-warning" aria-label={t("needsSettings")} /> : null}
      </div>
      {(def?.handles ?? ["out"]).map((h, i, all) => (
        <Handle
          key={h}
          id={h}
          type="source"
          position={Position.Bottom}
          style={{ left: `${((i + 1) / (all.length + 1)) * 100}%` }}
          className="!size-2.5 !border-2 !border-background !bg-foreground/70"
        >
          {all.length > 1 ? <span className="pointer-events-none absolute left-1/2 top-2.5 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">{t(`handle.${h}` as "handle.true")}</span> : null}
        </Handle>
      ))}
    </div>
  );
}

function summarize(config: Record<string, unknown>): string {
  for (const key of ["prompt", "input", "query", "subject", "text", "title", "question", "left", "frequency", "template"]) {
    const v = config[key];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").slice(0, 60);
  }
  return "";
}
