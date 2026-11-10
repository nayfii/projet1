"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookOpenTextIcon, FileTextIcon, PlusIcon, ScaleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DOC_TEMPLATES, type DocTemplate } from "../templates";
import { DECISION_STATUSES, type DecisionStatus } from "../types";
import { ChoiceMenu, ScalePageHeader, Segmented, useDates } from "./primitives";
import { useIndex } from "./selectors";
import { usePanel, usePref, useScale, useScaleActions } from "./store";

type Tab = "documents" | "decisions";

export function StrategyPage() {
  const t = useTranslations("scale.strategy");
  const [tab, setTab] = usePref<Tab>("strategy-tab", "documents");
  const [picker, setPicker] = React.useState(false);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <ScalePageHeader
        title={t("title")}
        description={t("description")}
        actions={
          tab === "documents" ? (
            <Button size="sm" onClick={() => setPicker(true)}>
              <PlusIcon />
              {t("newDocument")}
            </Button>
          ) : (
            <NewDecisionButton />
          )
        }
      />
      <Segmented
        value={tab}
        onChange={setTab}
        label={t("tabs.label")}
        className="mb-6"
        options={[
          { value: "documents", label: t("tabs.documents"), icon: <BookOpenTextIcon /> },
          { value: "decisions", label: t("tabs.decisions"), icon: <ScaleIcon /> },
        ]}
      />
      {tab === "documents" ? <Documents onNew={() => setPicker(true)} /> : <Decisions />}
      <TemplatePicker open={picker} onOpenChange={setPicker} onDecisionLog={() => setTab("decisions")} />
    </div>
  );
}

function Documents({ onNew }: { onNew: () => void }) {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const dates = useDates();
  const docs = data.documents.filter((d) => !d.archived_at);
  if (!docs.length) {
    return (
      <div className="rounded-2xl border border-dashed px-6 py-14 text-center">
        <BookOpenTextIcon className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 font-medium">{t("strategy.emptyTitle")}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("strategy.emptyText")}</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={onNew}>
          <PlusIcon />
          {t("strategy.newDocument")}
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {docs.map((d) => {
        const project = d.project_id ? index.projectById.get(d.project_id) : null;
        return (
          <Link key={d.id} href={`/scale/strategy/${d.id}`} className="group flex flex-col rounded-2xl border bg-card p-4 shadow-xs outline-none transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <FileTextIcon className="size-4 text-muted-foreground" />
            </span>
            <p className="mt-3 font-medium leading-snug">{d.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {d.template_key && d.template_key !== "blank" && (DOC_TEMPLATES as readonly string[]).includes(d.template_key) && t(`strategy.templates.${d.template_key as DocTemplate}`) !== d.title ? `${t(`strategy.templates.${d.template_key as DocTemplate}`)} · ` : ""}
              {t("strategy.edited", { when: dates.relative(d.updated_at) })}
            </p>
            {project ? <p className="mt-auto truncate pt-3 text-xs text-muted-foreground">{project.title}</p> : null}
          </Link>
        );
      })}
    </div>
  );
}

function TemplatePicker({ open, onOpenChange, onDecisionLog }: { open: boolean; onOpenChange: (o: boolean) => void; onDecisionLog: () => void }) {
  const t = useTranslations("scale.strategy");
  const tc = useTranslations("scale.common");
  const actions = useScaleActions();
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("pickTitle")}</DialogTitle>
          <DialogDescription>{t("pickText")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2">
          {DOC_TEMPLATES.map((k) => (
            <button
              key={k}
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                if (k === "decision_log") {
                  onOpenChange(false);
                  onDecisionLog();
                  return;
                }
                setBusy(k);
                const row = await actions.create("document", { title: t(`templates.${k}`), template_key: k });
                setBusy(null);
                if (row) {
                  onOpenChange(false);
                  router.push(`/scale/strategy/${row.id}`);
                }
              }}
              className={cn("rounded-xl border p-3 text-left outline-none transition-colors hover:border-foreground/30 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", busy === k && "animate-pulse")}
            >
              <span className="block text-sm font-medium">{t(`templates.${k}`)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(`templateHints.${k}`)}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewDecisionButton() {
  const t = useTranslations("scale");
  const actions = useScaleActions();
  const panel = usePanel();
  return (
    <Button
      size="sm"
      onClick={async () => {
        const row = await actions.create("decision", { subject: t("decision.untitled") });
        if (row) panel.open("decision", row.id);
      }}
    >
      <PlusIcon />
      {t("strategy.newDecision")}
    </Button>
  );
}

/** The decision log: each decision with its options, choice, reasons, evidence and review date. */
function Decisions() {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const panel = usePanel();
  const dates = useDates();
  const [status, setStatus] = usePref<DecisionStatus | null>("decisions-status", null);
  const list = data.decisions.filter((d) => !d.archived_at && (!status || d.status === status));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("strategy.decisionsIntro")}</p>
        <ChoiceMenu value={status} options={DECISION_STATUSES} label={(s) => t(`decisionStatus.${s}`)} onChange={setStatus} allowNone noneLabel={t("strategy.allDecisions")} ariaLabel={t("fields.status")} className="h-8 border text-xs" />
      </div>
      {list.length === 0 ? <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{t("strategy.noDecisions")}</div> : null}
      <ol className="space-y-2">
        {list.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => panel.open("decision", d.id)} className="w-full rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-foreground/20">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">{d.subject}</p>
                <span className={cn("rounded-full px-2 py-0.5 text-xs", d.status === "decided" ? "bg-foreground text-background" : d.status === "pending" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>{t(`decisionStatus.${d.status}`)}</span>
              </div>
              {d.choice ? (
                <p className="mt-2 border-l-2 border-foreground/60 pl-3 text-sm">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("fields.choice")} · </span>
                  {d.choice}
                </p>
              ) : null}
              <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                {d.decided_on ? <span>{t("strategy.decidedOn", { date: dates.short(d.decided_on) })}</span> : null}
                {d.review_on ? <span className={cn(d.review_on <= index.today && "text-warning")}>{t("strategy.reviewOn", { date: dates.short(d.review_on) })}</span> : null}
                {d.test_id ? <span>{t("strategy.fromTest", { title: index.testById.get(d.test_id)?.title ?? "" })}</span> : null}
                {d.project_id ? <span>{index.projectById.get(d.project_id)?.title}</span> : null}
              </p>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
