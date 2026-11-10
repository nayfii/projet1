"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpRightIcon, BadgeCheckIcon, CalendarCheckIcon, CircleAlertIcon, FlagIcon, FlaskConicalIcon, FolderKanbanIcon, PinIcon, PinOffIcon, PlusIcon, ScaleIcon, SparklesIcon, TargetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addDays } from "../logic/dates";
import { isClosedTask, objectiveAttainment, taskProgress, tasksOfWeek, weekLoad } from "../logic/planning";
import type { Project } from "../types";
import { Onboarding } from "./onboarding";
import { HealthBadge, NotFilled, NumberField, ProgressBar, RecordMenu, ScalePageHeader, SectionTitle, useDates } from "./primitives";
import { useIndex } from "./selectors";
import { useShell } from "./shell";
import { usePanel, useScale, useScaleActions } from "./store";
import { TaskRow } from "./task-row";
import { WeeklyReviewButton } from "./weekly-review";

/** Scale's home: where Cendr stands, the next heading, this week, what is stuck, active projects. */
export function Overview() {
  const t = useTranslations("scale.overview");
  const data = useScale();
  const index = useIndex();
  const shell = useShell();
  const dates = useDates();

  if (!data.settings?.onboarded_at) return <Onboarding />;

  const activeProjects = index.projects.filter((p) => p.status === "active");
  const running = index.tests.filter((x) => x.status === "running").length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <ScalePageHeader
        eyebrow={<span className="capitalize">{dates.long(index.today)}</span>}
        title={t("title")}
        description={t("summary", { projects: activeProjects.length, tasks: index.openTasks.filter((x) => !x.parent_id).length, tests: running })}
        actions={
          <>
            <WeeklyReviewButton />
            <Button size="sm" onClick={() => shell.capture()}>
              <PlusIcon />
              {t("capture")}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <FocusCard />
          <ThisWeek />
        </div>
        <div className="min-w-0 space-y-6">
          <Unblock />
          <Recent />
        </div>
      </div>
      <ActiveProjects projects={activeProjects} />
    </div>
  );
}

function Card({ children, className, labelledBy }: { children: React.ReactNode; className?: string; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className={cn("min-w-0 rounded-2xl border bg-card p-5 shadow-xs sm:p-6", className)}>
      {children}
    </section>
  );
}

// ─── My next heading ────────────────────────────────────────────────────────

function FocusCard() {
  const t = useTranslations("scale.overview");
  const ts = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const dates = useDates();
  const o = index.focus;

  if (!o) {
    return (
      <Card labelledBy="focus-title">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
            <TargetIcon className="size-4 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 id="focus-title" className="font-semibold">
                {t("focus.emptyTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("focus.emptyText")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {index.objectives.length ? (
                <RecordMenu value={null} items={index.objectives.map((x) => ({ id: x.id, label: x.title }))} onChange={(id) => id && void actions.update("objective", id, { is_focus: true })} noneLabel={t("focus.choose")} ariaLabel={t("focus.choose")} className="border" />
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const row = await actions.create("objective", { title: t("focus.newTitle"), is_focus: true });
                  if (row) panel.open("objective", row.id);
                }}
              >
                <PlusIcon />
                {t("focus.create")}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const projects = index.projectsByObjective.get(o.id) ?? [];
  const attainment = objectiveAttainment(o);
  const work = taskProgress(projects.flatMap((p) => index.tasksByProject.get(p.id) ?? []));
  const milestones = projects
    .flatMap((p) => (index.milestonesByProject.get(p.id) ?? []).map((m) => ({ ...m, projectTitle: p.title })))
    .filter((m) => !m.achieved_date)
    .sort((a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"))
    .slice(0, 3);

  return (
    <Card labelledBy="focus-title" className="relative overflow-hidden">
      <div className="flex flex-wrap-reverse items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <TargetIcon className="size-3.5" />
            {t("focus.label")}
          </p>
          <button type="button" onClick={() => panel.open("objective", o.id)} className="mt-1.5 text-left outline-none focus-visible:underline">
            <h2 id="focus-title" className="text-xl font-semibold tracking-tight sm:text-2xl">
              {o.title}
            </h2>
          </button>
          {o.metric || o.description ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{o.metric ?? o.description}</p> : null}
        </div>
        <RecordMenu value={null} items={index.objectives.filter((x) => x.id !== o.id).map((x) => ({ id: x.id, label: x.title }))} onChange={(id) => id && void actions.update("objective", id, { is_focus: true })} noneLabel={t("focus.change")} ariaLabel={t("focus.change")} className="shrink-0 text-xs text-muted-foreground" />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("focus.result")}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">
            {o.kind === "validation" ? ts(`validation.${o.validation_state}`) : attainment === null ? <NotFilled /> : `${dates.number(o.current_value ?? 0)} / ${dates.number(o.target ?? 0)}${o.unit ? ` ${o.unit}` : ""}`}
          </p>
          {o.kind === "numeric" ? <ProgressBar ratio={attainment} label={t("focus.result")} tone="success" className="mt-1.5" /> : null}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("focus.work")}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{work.total ? ts("common.doneOf", { done: work.done, total: work.total }) : <NotFilled>{t("focus.noTasks")}</NotFilled>}</p>
          <ProgressBar ratio={work.ratio} label={t("focus.work")} className="mt-1.5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("focus.target")}</p>
          <p className="mt-0.5 text-lg font-semibold">{o.due_date ? dates.short(o.due_date) : <NotFilled>{t("focus.noDate")}</NotFilled>}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("focus.distinct")}</p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <SectionTitle>{t("focus.milestones")}</SectionTitle>
          {milestones.length === 0 ? <p className="text-sm text-muted-foreground">{t("focus.noMilestones")}</p> : null}
          <ul className="space-y-2">
            {milestones.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => panel.open("milestone", m.id)} className="flex w-full items-start gap-2 text-left text-sm">
                  <FlagIcon className={cn("mt-0.5 size-4 shrink-0", m.target_date && m.target_date < index.today ? "text-destructive" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.projectTitle}
                      {m.target_date ? ` · ${dates.short(m.target_date)}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionTitle>{t("focus.projects")}</SectionTitle>
          {projects.length === 0 ? <p className="text-sm text-muted-foreground">{t("focus.noProjects")}</p> : null}
          <ul className="space-y-1.5">
            {projects.slice(0, 5).map((p) => (
              <li key={p.id} className="flex min-w-0 items-center gap-2 text-sm">
                <Link href={`/scale/projects/${p.id}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                  {p.title}
                </Link>
                <HealthBadge health={p.health} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

// ─── This week ──────────────────────────────────────────────────────────────

function ThisWeek() {
  const t = useTranslations("scale.overview");
  const ts = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const shell = useShell();
  const dates = useDates();
  const capacity = index.capacityFor(index.monday);
  const load = weekLoad(data.tasks.filter((x) => !x.parent_id), index.monday, capacity);
  const week = tasksOfWeek(index.tasks.filter((x) => !x.parent_id), index.monday);
  const priorities = (index.week?.priority_task_ids ?? []).map((id) => index.taskById.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x) && !x!.archived_at);
  const rest = week.filter((x) => !priorities.some((p) => p.id === x.id)).sort((a, b) => Number(isClosedTask(a)) - Number(isClosedTask(b)) || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const ratio = capacity ? Math.min(1, load.planned / capacity) : null;
  const pin = (id: string, on: boolean) => {
    const current = index.week?.priority_task_ids ?? [];
    const next = on ? [...current.filter((x) => x !== id), id].slice(-3) : current.filter((x) => x !== id);
    void actions.saveWeek(index.monday, { priority_task_ids: next });
  };

  return (
    <Card labelledBy="week-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="week-title" className="flex items-center gap-2 font-semibold">
            <CalendarCheckIcon className="size-4 text-muted-foreground" />
            {t("week.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("week.range", { from: dates.short(index.monday), to: dates.short(addDays(index.monday, 6)) })}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => shell.capture({ weekStart: index.monday })}>
          <PlusIcon />
          {t("week.add")}
        </Button>
      </div>

      {/* Capacity typed in, against estimated effort (estimates stay estimates). */}
      <div className="mt-4 rounded-xl bg-muted/50 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {t("week.planned", { hours: dates.number(load.planned) })}
            {capacity !== null ? <span className="text-muted-foreground"> / {t("week.capacity", { hours: dates.number(capacity) })}</span> : null}
          </span>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            {t("week.capacityLabel")}
            <NumberField value={index.week?.capacity_hours ?? data.settings?.weekly_capacity_hours ?? null} onSave={(v) => void actions.saveWeek(index.monday, { capacity_hours: v })} ariaLabel={t("week.capacityLabel")} placeholder="—" suffix={ts("common.h")} min={0} max={168} />
          </label>
        </div>
        <ProgressBar ratio={ratio} label={t("week.loadLabel")} className={cn("mt-2", load.over ? "[&>div]:bg-destructive" : "")} />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {capacity === null ? <span>{t("week.noCapacity")}</span> : null}
          {load.over ? (
            <span className="inline-flex items-center gap-1 font-medium text-destructive">
              <CircleAlertIcon className="size-3.5" />
              {t("week.over", { hours: dates.number(load.over) })}
            </span>
          ) : null}
          {load.unestimated ? <span>{t("week.unestimated", { count: load.unestimated })}</span> : null}
          <span>{t("week.estimatesNote")}</span>
        </div>
      </div>

      <div className="mt-5">
        <SectionTitle>{t("week.priorities")}</SectionTitle>
        {priorities.length === 0 ? <p className="text-sm text-muted-foreground">{t("week.noPriorities")}</p> : null}
        <div className="space-y-0.5">
          {priorities.map((task, i) => (
            <div key={task.id} className="flex items-center gap-1">
              <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
              <TaskRow task={task} className="min-w-0 flex-1" />
              <button type="button" aria-label={t("week.unpin", { title: task.title })} onClick={() => pin(task.id, false)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <PinOffIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <SectionTitle>{t("week.tasks", { count: rest.length })}</SectionTitle>
        {week.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t("week.empty")}{" "}
            <Link href="/scale/projects?view=unplanned" className="font-medium text-foreground underline-offset-2 hover:underline">
              {t("week.emptyLink")}
            </Link>
          </div>
        ) : null}
        <div className="space-y-0.5">
          {rest.map((task) => (
            <div key={task.id} className="flex items-center gap-1">
              <TaskRow task={task} className="min-w-0 flex-1" />
              {!isClosedTask(task) && priorities.length < 3 ? (
                <button type="button" aria-label={t("week.pin", { title: task.title })} onClick={() => pin(task.id, true)} className="rounded p-1 text-muted-foreground opacity-50 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100">
                  <PinIcon className="size-3.5" />
                </button>
              ) : (
                <span className="w-[22px]" />
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── What is stuck ──────────────────────────────────────────────────────────

function Unblock() {
  const t = useTranslations("scale.overview");
  const router = useRouter();
  const data = useScale();
  const index = useIndex();
  const panel = usePanel();
  const dates = useDates();
  const blocked = index.openTasks.filter((x) => x.status === "blocked" || index.blockersOf(x.id).length);
  const overdue = index.openTasks.filter((x) => x.due_date && x.due_date < index.today && !blocked.includes(x));
  const decisions = data.decisions.filter((d) => !d.archived_at && d.status === "pending");
  const risky = index.projects.filter((p) => p.health !== "on_track" && p.status !== "done" && p.status !== "cancelled");
  const total = blocked.length + overdue.length + decisions.length + risky.length;

  const group = (title: string, items: { key: string; label: string; detail?: string | null; onClick: () => void; tone?: "red" | "amber" }[]) =>
    items.length ? (
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
        <ul className="space-y-0.5">
          {items.slice(0, 6).map((i) => (
            <li key={i.key}>
              <button type="button" onClick={i.onClick} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60">
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", i.tone === "amber" ? "bg-warning" : "bg-destructive")} />
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                {i.detail ? <span className="shrink-0 text-xs text-muted-foreground">{i.detail}</span> : null}
              </button>
            </li>
          ))}
          {items.length > 6 ? <li className="px-1.5 text-xs text-muted-foreground">{t("unblock.more", { count: items.length - 6 })}</li> : null}
        </ul>
      </div>
    ) : null;

  return (
    <Card labelledBy="unblock-title">
      <h2 id="unblock-title" className="flex items-center gap-2 font-semibold">
        <CircleAlertIcon className="size-4 text-muted-foreground" />
        {t("unblock.title")}
        {total ? <span className="rounded-full bg-destructive-soft px-2 py-0.5 text-xs font-medium text-destructive">{total}</span> : null}
      </h2>
      {total === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <BadgeCheckIcon className="size-4 text-success" />
          {t("unblock.none")}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {group(
            t("unblock.blocked"),
            blocked.map((x) => ({ key: x.id, label: x.title, detail: index.blockersOf(x.id).length ? t("unblock.waitsFor", { count: index.blockersOf(x.id).length }) : null, onClick: () => panel.open("task", x.id) })),
          )}
          {group(
            t("unblock.decisions"),
            decisions.map((d) => ({ key: d.id, label: d.subject, onClick: () => panel.open("decision", d.id), tone: "amber" as const })),
          )}
          {group(
            t("unblock.overdue"),
            overdue.map((x) => ({ key: x.id, label: x.title, detail: dates.short(x.due_date!), onClick: () => panel.open("task", x.id) })),
          )}
          {group(
            t("unblock.risky"),
            risky.map((p) => ({ key: p.id, label: p.title, detail: null, onClick: () => router.push(`/scale/projects/${p.id}`), tone: p.health === "at_risk" ? ("amber" as const) : ("red" as const) })),
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Recent progress ────────────────────────────────────────────────────────

const WINS = new Set(["milestone_reached", "test_concluded", "decision_taken", "project_done", "objective_reached", "review_done"]);
const WIN_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  milestone_reached: FlagIcon,
  test_concluded: FlaskConicalIcon,
  decision_taken: ScaleIcon,
  project_done: FolderKanbanIcon,
  objective_reached: TargetIcon,
  review_done: CalendarCheckIcon,
};

function Recent() {
  const t = useTranslations("scale.overview");
  const ta = useTranslations("scale.activity");
  const data = useScale();
  const index = useIndex();
  const dates = useDates();
  const wins = data.recent.filter((a) => WINS.has(a.action)).slice(0, 8);
  return (
    <Card labelledBy="recent-title">
      <h2 id="recent-title" className="flex items-center gap-2 font-semibold">
        <SparklesIcon className="size-4 text-muted-foreground" />
        {t("recent.title")}
      </h2>
      {wins.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{t("recent.none")}</p> : null}
      <ol className="mt-3 space-y-2.5">
        {wins.map((a) => {
          const Icon = WIN_ICON[a.action] ?? SparklesIcon;
          const d = (a.details ?? {}) as { title?: string; to?: string; week?: string };
          const who = a.actor_id ? (index.personById.get(a.actor_id)?.name ?? ta("someone")) : ta("someone");
          return (
            <li key={a.id} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{t(`recent.${a.action}` as Parameters<typeof t>[0], { title: d.title ?? "", conclusion: d.to && ta.has(`conclusions.${d.to}` as Parameters<typeof ta>[0]) ? ` (${ta(`conclusions.${d.to}` as Parameters<typeof ta>[0])})` : "" })}</span>
                <span className="block text-xs text-muted-foreground">
                  {who} · {dates.relative(a.created_at)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ─── Active projects ────────────────────────────────────────────────────────

function ActiveProjects({ projects }: { projects: Project[] }) {
  const t = useTranslations("scale.overview");
  return (
    <section aria-labelledby="active-title" className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="active-title" className="font-semibold">
          {t("projects.title")}
        </h2>
        <Link href="/scale/projects" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          {t("projects.all")}
          <ArrowUpRightIcon className="size-3.5" />
        </Link>
      </div>
      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("projects.none")}</p>
          <Link href="/scale/projects" className="mt-2 inline-block text-sm font-medium underline-offset-2 hover:underline">
            {t("projects.go")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A project at a glance: status, health, next action, next milestone, due date, task progress. */
export function ProjectCard({ project: p }: { project: Project }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const dates = useDates();
  const tasks = index.tasksByProject.get(p.id) ?? [];
  const progress = taskProgress(tasks);
  const next = (index.milestonesByProject.get(p.id) ?? []).filter((m) => !m.achieved_date).sort((a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"))[0];
  const late = p.target_date && p.target_date < index.today && p.status !== "done";
  return (
    <Link
      href={`/scale/projects/${p.id}`}
      className="group flex flex-col rounded-2xl border bg-card p-4 shadow-xs outline-none transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-medium leading-snug">{p.title}</h3>
        <HealthBadge health={p.health} className="shrink-0" />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(`projectStatus.${p.status}`)}
        {p.axis ? ` · ${t(`axis.${p.axis}`)}` : ""}
      </p>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">{t("projects.nextAction")}</dt>
          <dd className="min-w-0 truncate">{p.next_action ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">{t("projects.nextMilestone")}</dt>
          <dd className="min-w-0 truncate">{next ? `${next.title}${next.target_date ? ` · ${dates.short(next.target_date)}` : ""}` : <span className="text-muted-foreground">—</span>}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">{t("projects.due")}</dt>
          <dd className={cn(late && "text-destructive")}>{p.target_date ? dates.short(p.target_date) : <span className="text-muted-foreground">—</span>}</dd>
        </div>
      </dl>
      <div className="mt-auto pt-4">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>{t("projects.tasks")}</span>
          <span className="tabular-nums">{progress.total ? `${progress.done}/${progress.total}` : "—"}</span>
        </div>
        <ProgressBar ratio={progress.ratio} label={t("projects.tasks")} />
      </div>
    </Link>
  );
}
