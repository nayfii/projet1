"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarCheckIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addDays } from "../logic/dates";
import { isClosedTask, tasksOfWeek } from "../logic/planning";
import { TaskStatusIcon, useDates } from "./primitives";
import { useIndex } from "./selectors";
import { useScale, useScaleActions } from "./store";

type Carry = "next_week" | "later" | "drop";

/**
 * The weekly review in five steps: done, learned, stuck, decisions to take, the next three
 * priorities. Unfinished tasks are never carried over silently: each one gets a choice.
 */
export function WeeklyReviewButton() {
  const t = useTranslations("scale.review");
  const data = useScale();
  const index = useIndex();
  const [open, setOpen] = React.useState(false);
  const done = data.reviews.some((r) => r.week_start === index.monday && r.completed_at);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {done ? <CheckIcon /> : <CalendarCheckIcon />}
        {done ? t("doneButton") : t("button")}
      </Button>
      {open ? <WeeklyReviewDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

function WeeklyReviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("scale.review");
  const tc = useTranslations("scale.common");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const dates = useDates();
  const monday = index.monday;
  const existing = data.reviews.find((r) => r.week_start === monday);
  const week = tasksOfWeek(index.tasks.filter((x) => !x.parent_id), monday);
  const doneTasks = week.filter((x) => x.status === "done");
  const unfinished = week.filter((x) => !isClosedTask(x));
  const blocked = index.openTasks.filter((x) => x.status === "blocked" || index.blockersOf(x.id).length);
  const pending = data.decisions.filter((d) => !d.archived_at && d.status === "pending");
  const candidates = index.openTasks.filter((x) => !x.parent_id);

  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState({
    done_summary: existing?.done_summary ?? "",
    learned: existing?.learned ?? "",
    blocked: existing?.blocked ?? "",
    decisions: existing?.decisions ?? "",
    next_priorities: existing?.next_priorities ?? "",
  });
  const [carry, setCarry] = React.useState<Record<string, Carry>>({});
  const [picks, setPicks] = React.useState<string[]>(data.weeks.find((w) => w.week_start === index.nextMonday)?.priority_task_ids ?? []);
  const [busy, setBusy] = React.useState(false);

  const steps: { key: "done" | "learned" | "blocked" | "decisions" | "priorities"; field: "done_summary" | "learned" | "blocked" | "decisions" | "next_priorities"; list: string[] }[] = [
    { key: "done", field: "done_summary" as const, list: doneTasks.map((x) => x.title) },
    { key: "learned", field: "learned" as const, list: data.tests.filter((x) => !x.archived_at && x.conclusion && x.updated_at >= `${monday}T00:00:00`).map((x) => x.title) },
    { key: "blocked", field: "blocked" as const, list: blocked.map((x) => x.title) },
    { key: "decisions", field: "decisions" as const, list: pending.map((d) => d.subject) },
    { key: "priorities", field: "next_priorities" as const, list: [] as string[] },
  ];
  const allChosen = unfinished.every((x) => carry[x.id]);
  const isLast = step === steps.length;

  async function saveDraft() {
    await actions.saveReview(monday, form, false);
  }

  async function finish() {
    setBusy(true);
    const okCarry = unfinished.length ? await actions.resolveCarryOver(unfinished.map((x) => ({ id: x.id, action: carry[x.id] })), index.nextMonday) : true;
    const okWeek = await actions.saveWeek(index.nextMonday, { priority_task_ids: picks.slice(0, 3) });
    const okReview = await actions.saveReview(monday, form, true);
    setBusy(false);
    if (okCarry && okWeek && okReview) onOpenChange(false);
  }

  const current = steps[step];
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : (void saveDraft(), onOpenChange(false)))}>
      <DialogContent closeLabel={tc("close")} className="max-h-[88dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title", { from: dates.short(monday), to: dates.short(addDays(monday, 6)) })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <ol className="flex gap-1" aria-label={t("progress")}>
          {[...steps.map((s) => s.key), "carry" as const].map((k, i) => (
            <li key={k} className="flex-1">
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                aria-label={t(`steps.${k}`)}
                className={cn("h-1.5 w-full rounded-full transition-colors", i < step ? "bg-foreground/60" : i === step ? "bg-foreground" : "bg-muted")}
              />
            </li>
          ))}
        </ol>

        {!isLast ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              {`${step + 1}. ${t(`steps.${current.key}`)}`}
            </p>
            <p className="text-sm text-muted-foreground">{t(`hints.${current.key}`)}</p>
            {current.list.length ? (
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-muted/50 p-3 text-[13px]">
                {current.list.map((x, i) => (
                  <li key={i} className="truncate">
                    · {x}
                  </li>
                ))}
              </ul>
            ) : null}
            {current.key === "priorities" ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("pickPriorities", { count: picks.length })}</p>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {candidates.map((x) => {
                    const on = picks.includes(x.id);
                    return (
                      <li key={x.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          disabled={!on && picks.length >= 3}
                          onClick={() => setPicks((p) => (on ? p.filter((y) => y !== x.id) : [...p, x.id]))}
                          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-40", on ? "bg-accent font-medium" : "hover:bg-accent/60")}
                        >
                          <TaskStatusIcon status={x.status} />
                          <span className="min-w-0 flex-1 truncate">{x.title}</span>
                          {on ? <span className="text-xs tabular-nums text-muted-foreground">{picks.indexOf(x.id) + 1}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <Textarea value={form[current.field]} onChange={(e) => setForm({ ...form, [current.field]: e.target.value })} maxLength={current.field === "next_priorities" ? 2000 : 5000} placeholder={t(`placeholders.${current.key}`)} aria-label={t(`steps.${current.key}`)} className="min-h-24" />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t("steps.carry")}</p>
            <p className="text-sm text-muted-foreground">{unfinished.length ? t("hints.carry") : t("hints.carryNone")}</p>
            <ul className="space-y-2">
              {unfinished.map((x) => (
                <li key={x.id} className="rounded-lg border p-2.5">
                  <p className="flex items-center gap-2 text-sm">
                    <TaskStatusIcon status={x.status} />
                    <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  </p>
                  <div role="radiogroup" aria-label={t("carryFor", { title: x.title })} className="mt-2 flex flex-wrap gap-1.5">
                    {(["next_week", "later", "drop"] as Carry[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={carry[x.id] === c}
                        onClick={() => setCarry({ ...carry, [x.id]: c })}
                        className={cn("rounded-full border px-3 py-1 text-xs transition-colors", carry[x.id] === c ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}
                      >
                        {t(`carry.${c}`)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              {t("back")}
            </Button>
          ) : null}
          {!isLast ? (
            <Button onClick={() => setStep(step + 1)}>{t("next")}</Button>
          ) : (
            <Button onClick={() => void finish()} disabled={!allChosen || busy}>
              {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
              {allChosen ? t("finish") : t("chooseAll")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
