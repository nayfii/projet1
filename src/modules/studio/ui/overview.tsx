"use client";

import * as React from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowRightIcon, CheckCheckIcon, CheckSquareIcon, FileTextIcon, FlagIcon, ListTodoIcon, MapIcon, SparklesIcon, TargetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { diffDays } from "../logic/dates";
import { focusTasks, indicators, upcomingMilestones, type FocusReason } from "../logic/plan";
import { isoToDate, ProgressBar, useCategoryName, useDates, useToday } from "./primitives";
import { useShell } from "./shell";
import { useIndex } from "./selectors";
import { TaskRow } from "./tasks";
import { usePanel, useStudio, useStudioActions } from "./store";

/**
 * The Overview: what to understand in five seconds each morning — where Cendr stands (four numbers
 * counted from the records), today's focus (chosen from Tasks), what comes next (from the Roadmap),
 * and the three things one creates most.
 */
export function OverviewPage() {
  const t = useTranslations("studio.overview");
  const data = useStudio();
  const today = useToday();
  const format = useFormatter();
  const hour = React.useSyncExternalStore(subscribeNothing, () => new Date().getHours(), () => 12);
  const numbers = indicators(data.tasks, data.milestones, today);
  const greeting = hour < 5 || hour >= 18 ? "evening" : hour < 12 ? "morning" : "afternoon";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-10">
        <p className="text-[13px] text-muted-foreground first-letter:uppercase">
          {format.dateTime(isoToDate(today), { weekday: "long", day: "numeric", month: "long" })}
          {data.me.firstName ? <span>{` · ${t(`hello.${greeting}`, { name: data.me.firstName })}`}</span> : null}
        </p>
        <h1 className="mt-2 text-[34px] font-semibold leading-tight tracking-[-0.03em]">{t("title")}</h1>
        <p className="mt-1 text-[17px] text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Indicators numbers={numbers} />

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <TodaysFocus />
        <div className="space-y-6">
          <WhatsNext />
          <QuickActions />
        </div>
      </div>
    </div>
  );
}

const subscribeNothing = () => () => {};

function Card({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={cn("rounded-2xl border bg-card/50 p-5 shadow-xs", className)}>
      {children}
    </section>
  );
}

function CardTitle({ icon, children, action }: { icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {children}
      </h2>
      {action}
    </div>
  );
}

// ─── Four numbers ───────────────────────────────────────────────────────────

function Indicators({ numbers }: { numbers: ReturnType<typeof indicators> }) {
  const t = useTranslations("studio.overview");
  const panel = usePanel();
  const dates = useDates();
  const today = useToday();
  const shell = useShell();
  const next = numbers.nextMilestone;
  const days = next?.target_date ? diffDays(today, next.target_date) : null;
  const tile = "group flex min-h-[7.5rem] flex-col justify-between rounded-2xl border bg-card/50 p-5 text-left shadow-xs outline-none transition-all hover:-translate-y-px hover:bg-card hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring";
  const label = "text-[13px] text-muted-foreground";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Link href="/studio/tasks" className={tile} data-testid="indicator-high">
        <span className={label}>{t("indicators.high")}</span>
        {numbers.hasTasks ? (
          <span className="flex items-baseline gap-2">
            <span className="text-[32px] font-semibold tabular-nums tracking-tight">{numbers.highOpen}</span>
            <span className="text-xs text-muted-foreground">{t("indicators.highUnit", { count: numbers.highOpen })}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{t("indicators.noTasks")}</span>
        )}
      </Link>
      <Link href="/studio/tasks" className={tile} data-testid="indicator-done">
        <span className={label}>{t("indicators.done")}</span>
        {numbers.hasTasks ? (
          <span className="flex items-baseline gap-2">
            <span className="text-[32px] font-semibold tabular-nums tracking-tight">{numbers.doneThisWeek}</span>
            <span className="text-xs text-muted-foreground">{t("indicators.doneUnit", { count: numbers.doneThisWeek })}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{t("indicators.noTasks")}</span>
        )}
      </Link>
      <button type="button" className={tile} data-testid="indicator-next" onClick={() => (next ? panel.open("milestone", next.id) : shell.create("milestone"))}>
        <span className={label}>{t("indicators.next")}</span>
        {next ? (
          <span className="min-w-0">
            <span className="line-clamp-2 text-[15px] font-semibold leading-snug">{next.title}</span>
            <span className={cn("mt-1 block text-xs", days !== null && days < 0 ? "text-destructive" : "text-muted-foreground")}>
              {next.target_date ? `${dates.short(next.target_date)} · ${days! < 0 ? t("late", { days: -days! }) : days === 0 ? t("dueToday") : t("inDays", { days: days! })}` : t("toSchedule")}
            </span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{t("indicators.noMilestone")}</span>
        )}
      </button>
      <Link href="/studio/roadmap" className={tile} data-testid="indicator-roadmap">
        <span className={label}>{t("indicators.roadmap")}</span>
        {numbers.roadmap.total ? (
          <span>
            <span className="flex items-baseline gap-2">
              <span className="text-[32px] font-semibold tabular-nums tracking-tight">{Math.round((numbers.roadmap.done / numbers.roadmap.total) * 100)}%</span>
              <span className="text-xs text-muted-foreground">{t("indicators.roadmapUnit", { done: numbers.roadmap.done, total: numbers.roadmap.total })}</span>
            </span>
            <ProgressBar ratio={numbers.roadmap.done / numbers.roadmap.total} label={t("indicators.roadmap")} className="mt-2 h-1" />
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{t("indicators.noMilestone")}</span>
        )}
      </Link>
    </div>
  );
}

// ─── Today's focus ──────────────────────────────────────────────────────────

const REASON_TONE: Record<FocusReason, string> = {
  overdue: "bg-destructive-soft text-destructive",
  today: "bg-warning-soft text-warning",
  high: "bg-muted text-foreground/80",
  in_progress: "bg-muted text-foreground/80",
  soon: "bg-muted text-foreground/80",
  next: "bg-muted text-muted-foreground",
};

function TodaysFocus() {
  const t = useTranslations("studio.overview");
  const data = useStudio();
  const actions = useStudioActions();
  const shell = useShell();
  const today = useToday();
  const [leaving, setLeaving] = React.useState<string[]>([]);
  const picked = focusTasks(data.tasks, today);
  // A task just checked stays a moment, struck through, before the next one takes its place.
  const rows = [...picked.map((p) => ({ task: p.task, reason: p.reason })), ...data.tasks.filter((x) => leaving.includes(x.id) && !picked.some((p) => p.task.id === x.id)).map((task) => ({ task, reason: "next" as FocusReason }))];
  const openCount = data.tasks.filter((x) => !x.archived_at && (x.status === "todo" || x.status === "in_progress")).length;

  return (
    <Card label={t("focus")} className="p-0">
      <div className="px-5 pt-5">
        <CardTitle
          icon={<TargetIcon />}
          action={
            <Link href="/studio/tasks" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
              {t("allTasks", { count: openCount })}
              <ArrowRightIcon className="size-3.5" />
            </Link>
          }
        >
          {t("focus")}
        </CardTitle>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center px-6 pb-10 pt-4 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">{openCount ? <CheckCheckIcon className="size-5" /> : <SparklesIcon className="size-5" />}</div>
          <p className="text-sm font-medium">{openCount ? t("focusClear") : t("focusEmpty")}</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{openCount ? t("focusClearBody") : t("focusEmptyBody")}</p>
          <Button size="sm" className="mt-4" onClick={() => shell.create("task", { priority: "high" })}>
            <CheckSquareIcon />
            {t("addPriority")}
          </Button>
        </div>
      ) : (
        <ul className="px-3 pb-3" data-testid="focus-list">
          {rows.map(({ task, reason }) => (
            <li key={task.id}>
              <TaskRow
                task={task}
                leaving={leaving.includes(task.id)}
                showPriority
                compact
                badge={leaving.includes(task.id) ? null : <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium max-sm:hidden", REASON_TONE[reason])}>{t(`reasons.${reason}`)}</span>}
                onDone={(done) => {
                  if (!done) return void actions.setDone(task.id, false);
                  setLeaving((l) => [...l, task.id]);
                  void actions.setDone(task.id, true);
                  setTimeout(() => setLeaving((l) => l.filter((x) => x !== task.id)), 650);
                }}
                className="min-h-12"
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── What's next (the roadmap) ──────────────────────────────────────────────

function WhatsNext() {
  const t = useTranslations("studio.overview");
  const data = useStudio();
  const index = useIndex();
  const panel = usePanel();
  const shell = useShell();
  const dates = useDates();
  const today = useToday();
  const name = useCategoryName();
  const next = upcomingMilestones(data.milestones, 4);
  return (
    <Card label={t("next")}>
      <CardTitle
        icon={<FlagIcon />}
        action={
          <Link href="/studio/roadmap" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            {t("roadmap")}
            <ArrowRightIcon className="size-3.5" />
          </Link>
        }
      >
        {t("next")}
      </CardTitle>
      {next.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-[13px] text-muted-foreground">{t("nextEmpty")}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => shell.create("milestone")}>
            <MapIcon />
            {t("addMilestone")}
          </Button>
        </div>
      ) : (
        <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-border">
          {next.map((m) => {
            const p = index.progress.get(m.id) ?? { done: 0, total: 0, ratio: null };
            const late = m.target_date && diffDays(today, m.target_date) < 0;
            return (
              <li key={m.id} className="relative">
                <button type="button" onClick={() => panel.open("milestone", m.id)} className="flex w-full gap-3 rounded-lg py-2 pl-0 pr-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/50">
                  <span aria-hidden className={cn("relative z-10 mt-1.5 size-[15px] shrink-0 rotate-45 rounded-[3px] border-2 bg-card", late ? "border-destructive" : m.status === "in_progress" ? "border-foreground" : "border-muted-foreground/50")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn(late && "text-destructive")}>{m.target_date ? dates.short(m.target_date) : t("toSchedule")}</span>
                      {m.category_id ? <span className="truncate">{`· ${name(index.categories.get(m.category_id))}`}</span> : null}
                    </span>
                    {p.total ? (
                      <span className="mt-1.5 flex items-center gap-2">
                        <ProgressBar ratio={p.ratio} label={t("progress")} tone={p.ratio === 1 ? "success" : "default"} className="h-1" />
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{`${p.done}/${p.total}`}</span>
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function QuickActions() {
  const t = useTranslations("studio.overview");
  const shell = useShell();
  const items = [
    { kind: "task" as const, icon: ListTodoIcon, label: t("quick.task") },
    { kind: "document" as const, icon: FileTextIcon, label: t("quick.document") },
    { kind: "milestone" as const, icon: FlagIcon, label: t("quick.milestone") },
  ];
  return (
    <Card label={t("quick.title")}>
      <h2 className="mb-3 text-[15px] font-semibold tracking-tight">{t("quick.title")}</h2>
      <div className="grid gap-2">
        {items.map((i) => (
          <button
            key={i.kind}
            type="button"
            onClick={() => shell.create(i.kind)}
            className="flex items-center gap-3 rounded-xl border bg-background/40 px-3 py-2.5 text-left text-sm outline-none transition-all hover:-translate-y-px hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
              <i.icon className="size-4" />
            </span>
            <span className="flex-1 font-medium">{i.label}</span>
            <span aria-hidden className="text-muted-foreground">
              {"+"}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
