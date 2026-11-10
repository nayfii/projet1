"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarRangeIcon, ChartGanttIcon, CircleAlertIcon, ColumnsIcon, EllipsisIcon, FlagIcon, GitBranchIcon, PlusIcon, TargetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addDays, diffDays, maxDate, minDate } from "../logic/dates";
import { dateConflicts, itemsInCycles, objectiveAttainment, taskProgress } from "../logic/planning";
import { AXES, HEALTHS, HORIZONS, PRIORITIES, PROJECT_STATUSES, type Axis, type Health, type Horizon, type Priority, type Project, type ProjectStatus } from "../types";
import { ChoiceMenu, DateField, HealthBadge, ProgressBar, ScalePageHeader, Segmented, useDates } from "./primitives";
import { useReschedule } from "./reschedule";
import { useIndex } from "./selectors";
import { usePanel, usePref, useScale, useScaleActions } from "./store";

type View = "timeline" | "horizons" | "objectives";
type Filters = { statuses: ProjectStatus[]; axis: Axis | null; priority: Priority | null; owner: string | null; health: Health | null };
const DEFAULT_FILTERS: Filters = { statuses: ["planned", "active", "paused", "done"], axis: null, priority: null, owner: null, health: null };

export function Roadmap() {
  const t = useTranslations("scale.roadmap");
  const [view, setView] = usePref<View>("roadmap-view", "timeline");
  const [filters, setFilters] = usePref<Filters>("roadmap-filters", DEFAULT_FILTERS);
  const index = useIndex();
  const projects = index.projects.filter(
    (p) =>
      (!filters.statuses.length || filters.statuses.includes(p.status)) &&
      (!filters.axis || p.axis === filters.axis) &&
      (!filters.priority || p.priority === filters.priority) &&
      (!filters.owner || p.owner_id === filters.owner) &&
      (!filters.health || p.health === filters.health),
  );
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-8 sm:py-10">
      <ScalePageHeader title={t("title")} description={t("description")} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={view}
          onChange={setView}
          label={t("views.label")}
          options={[
            { value: "timeline", label: t("views.timeline"), icon: <ChartGanttIcon /> },
            { value: "horizons", label: t("views.horizons"), icon: <ColumnsIcon /> },
            { value: "objectives", label: t("views.objectives"), icon: <TargetIcon /> },
          ]}
        />
        {view !== "objectives" ? <RoadmapFilters filters={filters} onChange={setFilters} /> : null}
      </div>
      {view === "timeline" ? <Timeline projects={projects} /> : view === "horizons" ? <Horizons projects={projects} /> : <Objectives />}
    </div>
  );
}

function RoadmapFilters({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const t = useTranslations("scale");
  const data = useScale();
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PROJECT_STATUSES.map((s) => {
        const on = filters.statuses.includes(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ ...filters, statuses: on ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s] })}
            className={cn("h-7 rounded-full border px-2.5 text-xs transition-colors", on ? "border-foreground/40 bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60")}
          >
            {t(`projectStatus.${s}`)}
          </button>
        );
      })}
      <ChoiceMenu value={filters.axis} options={AXES} label={(a) => t(`axis.${a}`)} onChange={(axis) => onChange({ ...filters, axis })} allowNone noneLabel={t("projects.allAxes")} ariaLabel={t("fields.axis")} className="h-7 border text-xs" />
      <ChoiceMenu value={filters.priority} options={PRIORITIES} label={(p) => t(`priority.${p}`)} onChange={(priority) => onChange({ ...filters, priority })} allowNone noneLabel={t("roadmap.allPriorities")} ariaLabel={t("fields.priority")} className="h-7 border text-xs" />
      <ChoiceMenu value={filters.health} options={HEALTHS} label={(h) => t(`health.${h}`)} onChange={(health) => onChange({ ...filters, health })} allowNone noneLabel={t("projects.allHealth")} ariaLabel={t("fields.health")} className="h-7 border text-xs" />
      <ChoiceMenu
        value={filters.owner}
        options={data.team.map((m) => m.id) as unknown as readonly [string, ...string[]]}
        label={(id) => data.team.find((m) => m.id === id)?.name ?? "—"}
        onChange={(owner) => onChange({ ...filters, owner })}
        allowNone
        noneLabel={t("roadmap.allOwners")}
        ariaLabel={t("fields.owner_id")}
        className="h-7 border text-xs"
      />
    </div>
  );
}

// ─── Timeline ───────────────────────────────────────────────────────────────

const HEALTH_BAR: Record<Health, string> = {
  on_track: "bg-foreground/80 text-background",
  at_risk: "bg-warning text-white",
  blocked: "bg-destructive text-white",
};

function Timeline({ projects }: { projects: Project[] }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const panel = usePanel();
  const dates = useDates();
  const reschedule = useReschedule();
  const [zoom, setZoom] = usePref<"months" | "weeks">("roadmap-zoom", "months");
  const [shiftFor, setShiftFor] = React.useState<Project | null>(null);
  const dayW = zoom === "weeks" ? 16 : 5;

  const dated = projects.filter((p) => p.start_date || p.target_date || p.achieved_date);
  const unplanned = projects.filter((p) => !p.start_date && !p.target_date && !p.achieved_date);
  const allDates = dated.flatMap((p) => [p.start_date, p.target_date, p.achieved_date]).concat((index.milestones.filter((m) => dated.some((p) => p.id === m.project_id)).map((m) => m.target_date)));
  // From the first day of the month before the earliest date, to a few months ahead.
  const from = `${addDays(minDate(index.today, ...allDates) ?? index.today, -14).slice(0, 7)}-01`;
  const to = addDays(maxDate(addDays(index.today, 120), ...allDates) ?? index.today, 30);
  const total = diffDays(from, to);
  const x = (d: string) => diffDays(from, d) * dayW;
  const months: string[] = [];
  for (let d = from; d <= to; ) {
    const first = `${d.slice(0, 7)}-01`;
    if (!months.includes(first)) months.push(first);
    const [y, m] = d.split("-").map(Number);
    d = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }

  const groups = [...AXES.map((a) => ({ key: a as string, label: t(`axis.${a}`), items: dated.filter((p) => p.axis === a) })), { key: "none", label: t("axis.none"), items: dated.filter((p) => !p.axis) }].filter((g) => g.items.length);
  const rows: ({ type: "group"; label: string; key: string } | { type: "project"; project: Project })[] = groups.flatMap((g) => [{ type: "group" as const, label: g.label, key: g.key }, ...g.items.map((p) => ({ type: "project" as const, project: p }))]);
  const ROW = 44;
  const HEAD = 32;
  const rowY = new Map<string, number>();
  rows.forEach((r, i) => r.type === "project" && rowY.set(r.project.id, HEAD + i * ROW + ROW / 2));
  const conflicts = dateConflicts(index.projects.map((p) => ({ id: p.id, start: p.start_date, end: p.target_date })), index.projectEdges);
  const conflictIds = new Set(conflicts.map((c) => c.id));
  const loops = itemsInCycles(index.projectEdges);
  const scroller = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, x(index.today) - el.clientWidth / 3);
    // Only when the zoom changes: the person scrolls freely afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={zoom} onChange={setZoom} label={t("roadmap.zoom")} options={[{ value: "months", label: t("roadmap.months") }, { value: "weeks", label: t("roadmap.weeks") }]} />
        <p className="text-xs text-muted-foreground">{t("roadmap.dragHint")}</p>
        <Legend />
      </div>
      {conflicts.length || loops.size ? (
        <div className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlertIcon className="size-4" />
            {t("roadmap.conflicts", { count: conflicts.length + loops.size })}
          </p>
          <ul className="mt-1 list-inside list-disc text-[13px]">
            {conflicts.map((c) => (
              <li key={`${c.id}-${c.dependsOn}`}>{t("roadmap.conflict", { name: index.projectById.get(c.id)?.title ?? "", other: index.projectById.get(c.dependsOn)?.title ?? "", days: c.days })}</li>
            ))}
            {[...loops].map((id) => (
              <li key={id}>{t("roadmap.loop", { name: index.projectById.get(id)?.title ?? "" })}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {dated.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{t("roadmap.noDated")}</div>
      ) : (
        <div className="flex overflow-hidden rounded-2xl border">
          {/* Names, always visible. */}
          <div className="w-44 shrink-0 border-r bg-card sm:w-60">
            <div className="h-8 border-b" />
            {rows.map((r, i) =>
              r.type === "group" ? (
                <div key={`g-${r.key}-${i}`} className="flex h-11 items-end px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {r.label}
                </div>
              ) : (
                <div key={r.project.id} className="flex h-11 items-center gap-1.5 border-t px-3">
                  {conflictIds.has(r.project.id) || loops.has(r.project.id) ? <CircleAlertIcon className="size-3.5 shrink-0 text-warning" aria-label={t("roadmap.inconsistent")} /> : null}
                  <Link href={`/scale/projects/${r.project.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                    {r.project.title}
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="rounded p-0.5 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("roadmap.actions", { name: r.project.title })}>
                      <EllipsisIcon className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => setShiftFor(r.project)}>
                        <CalendarRangeIcon />
                        {t("roadmap.moveDates")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ),
            )}
          </div>
          <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto">
            <div className="relative" style={{ width: total * dayW, height: HEAD + rows.length * ROW }}>
              {/* Months */}
              {months.map((m) => (
                <div key={m} className="absolute top-0 h-full border-l border-border/60" style={{ left: Math.max(0, x(m)) }}>
                  <span className="sticky top-0 block whitespace-nowrap px-2 pt-2 text-[11px] font-medium capitalize text-muted-foreground">{dates.monthYear(m)}</span>
                </div>
              ))}
              {/* Today */}
              <div className="absolute top-0 z-10 h-full w-px bg-destructive/70" style={{ left: x(index.today) }} aria-hidden>
                <span className="absolute -left-[3px] top-7 size-[7px] rounded-full bg-destructive" />
              </div>
              {/* Dependencies: from the end of what is waited for to the start of what waits. */}
              <svg className="pointer-events-none absolute inset-0 z-10" width={total * dayW} height={HEAD + rows.length * ROW} aria-hidden>
                {index.projectEdges.map((e) => {
                  const a = index.projectById.get(e.to);
                  const b = index.projectById.get(e.from);
                  const ya = rowY.get(e.to);
                  const yb = rowY.get(e.from);
                  if (!a || !b || ya === undefined || yb === undefined) return null;
                  const ax = x(a.target_date ?? a.start_date ?? index.today) + dayW;
                  const bx = x(b.start_date ?? b.target_date ?? index.today);
                  const bad = conflictIds.has(b.id);
                  const mid = Math.max(ax + 8, (ax + bx) / 2);
                  return <path key={`${e.from}-${e.to}`} d={`M ${ax} ${ya} H ${mid} V ${yb} H ${bx}`} fill="none" strokeWidth={1.5} className={bad ? "stroke-warning" : "stroke-muted-foreground/50"} strokeDasharray={bad ? "4 3" : undefined} markerEnd="url(#arrow)" />;
                })}
                <defs>
                  <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground/60" />
                  </marker>
                </defs>
              </svg>
              {rows.map((r, i) => {
                if (r.type === "group") return null;
                const p = r.project;
                const start = p.start_date ?? p.target_date ?? p.achieved_date!;
                const end = p.target_date ?? p.start_date ?? p.achieved_date!;
                return (
                  <React.Fragment key={p.id}>
                    <div className="absolute inset-x-0 border-t border-border/50" style={{ top: HEAD + i * ROW }} />
                    <Bar project={p} top={HEAD + i * ROW + 10} left={x(start)} width={Math.max(dayW, (diffDays(start, end) + 1) * dayW)} dayW={dayW} onMove={(days) => reschedule("project", p.id, { start: p.start_date ? addDays(p.start_date, days) : null, end: p.target_date ? addDays(p.target_date, days) : null })} />
                    {p.achieved_date ? (
                      <span title={t("roadmap.achievedOn", { date: dates.short(p.achieved_date) })} className="absolute z-20 size-2.5 rotate-45 border-2 border-background bg-success" style={{ top: HEAD + i * ROW + ROW / 2 - 5, left: x(p.achieved_date) + dayW / 2 - 5 }} />
                    ) : null}
                    {(index.milestonesByProject.get(p.id) ?? [])
                      .filter((m) => m.target_date)
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => panel.open("milestone", m.id)}
                          title={`${m.title} · ${dates.short(m.target_date!)}${m.achieved_date ? ` · ${t("milestone.reachedOn", { date: dates.short(m.achieved_date) })}` : ""}`}
                          aria-label={m.title}
                          className="absolute z-20 -translate-x-1/2"
                          style={{ top: HEAD + i * ROW + 2, left: x(m.target_date!) + dayW / 2 }}
                        >
                          <FlagIcon className={cn("size-3.5 drop-shadow-sm", m.achieved_date ? "fill-success text-success" : m.target_date! < index.today ? "fill-destructive text-destructive" : "fill-background text-foreground")} />
                        </button>
                      ))}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <section aria-labelledby="unplanned-title">
        <h2 id="unplanned-title" className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("roadmap.unplanned", { count: unplanned.length })}
        </h2>
        {unplanned.length === 0 ? <p className="text-sm text-muted-foreground">{t("roadmap.allPlanned")}</p> : null}
        <ul className="divide-y rounded-2xl border">
          {unplanned.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Link href={`/scale/projects/${p.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                {p.title}
              </Link>
              <HealthBadge health={p.health} />
              <DateField value={null} onChange={(d) => d && reschedule("project", p.id, { start: d, end: null })} label={t("fields.start_date")} placeholder={t("fields.start_date")} />
              <DateField value={null} onChange={(d) => d && reschedule("project", p.id, { start: null, end: d })} label={t("fields.target_date")} placeholder={t("fields.target_date")} />
            </li>
          ))}
        </ul>
      </section>
      {shiftFor ? <ShiftDialog project={shiftFor} onClose={() => setShiftFor(null)} /> : null}
    </div>
  );
}

function Legend() {
  const t = useTranslations("scale.roadmap");
  return (
    <ul className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className="h-2 w-5 rounded-full bg-foreground/80" />
        {t("legend.target")}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2 rotate-45 bg-success" />
        {t("legend.achieved")}
      </li>
      <li className="flex items-center gap-1.5">
        <FlagIcon className="size-3.5" />
        {t("legend.milestone")}
      </li>
      <li className="flex items-center gap-1.5">
        <GitBranchIcon className="size-3.5" />
        {t("legend.dependency")}
      </li>
    </ul>
  );
}

/** A project's bar: from its start to its target date. Dragged sideways, its dates move (after a preview). */
function Bar({ project: p, top, left, width, dayW, onMove }: { project: Project; top: number; left: number; width: number; dayW: number; onMove: (days: number) => void }) {
  const t = useTranslations("scale");
  const dates = useDates();
  const [dx, setDx] = React.useState(0);
  const start = React.useRef<number | null>(null);
  const moved = React.useRef(false);
  const days = Math.round(dx / dayW);
  return (
    <Link
      href={`/scale/projects/${p.id}`}
      draggable={false}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = e.clientX;
        moved.current = false;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const d = e.clientX - start.current;
        if (Math.abs(d) > 4) moved.current = true;
        setDx(d);
      }}
      onPointerUp={() => {
        start.current = null;
        setDx(0);
        if (moved.current && days !== 0) onMove(days);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDx(0);
      }}
      onClick={(e) => {
        if (moved.current) e.preventDefault();
      }}
      title={`${p.title} · ${p.start_date ? dates.short(p.start_date) : "?"} → ${p.target_date ? dates.short(p.target_date) : "?"}`}
      className={cn("absolute z-[15] flex h-6 cursor-grab touch-pan-y items-center overflow-hidden rounded-full px-2.5 text-[11px] font-medium shadow-xs outline-none ring-offset-1 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing", HEALTH_BAR[p.health], p.status === "done" && "opacity-60")}
      style={{ top, left: left + dx, width }}
    >
      <span className="truncate">
        {dx && days ? t("roadmap.shiftBy", { days }) : `${t(`projectStatus.${p.status}`)}${p.health !== "on_track" ? ` · ${t(`health.${p.health}`)}` : ""}`}
      </span>
    </Link>
  );
}

/** The keyboard way to move a project's dates. */
function ShiftDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const t = useTranslations("scale.roadmap");
  const tc = useTranslations("scale.common");
  const reschedule = useReschedule();
  const [start, setStart] = React.useState(project.start_date ?? "");
  const [end, setEnd] = React.useState(project.target_date ?? "");
  const invalid = Boolean(start && end && start > end);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("moveDates")}</DialogTitle>
          <DialogDescription>{project.title}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t("start")}</span>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t("target")}</span>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={invalid || undefined} />
          </label>
        </div>
        {invalid ? <p className="text-sm text-destructive">{t("invalidRange")}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={invalid}
            onClick={() => {
              reschedule("project", project.id, { start: start || null, end: end || null });
              onClose();
            }}
          >
            {t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Now / Next / Later ─────────────────────────────────────────────────────

function Horizons({ projects }: { projects: Project[] }) {
  const t = useTranslations("scale");
  const actions = useScaleActions();
  const index = useIndex();
  const dates = useDates();
  const [drag, setDrag] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const columns: (Horizon | "none")[] = [...HORIZONS, "none"];
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {columns.map((h) => {
        const items = projects.filter((p) => (p.horizon ?? "none") === h);
        if (h === "none" && !items.length) return null;
        return (
          <section
            key={h}
            aria-label={t(`horizon.${h}`)}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              setOver(h);
            }}
            onDragLeave={() => setOver((o) => (o === h ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const id = drag ?? e.dataTransfer.getData("text/plain");
              setDrag(null);
              setOver(null);
              if (id) void actions.update("project", id, { horizon: h === "none" ? null : h });
            }}
            className={cn("rounded-2xl bg-muted/40 p-2 transition-colors", over === h && "bg-accent ring-2 ring-ring/30")}
          >
            <h2 className="px-2 py-1.5 text-sm font-semibold">
              {t(`horizon.${h}`)} <span className="font-normal tabular-nums text-muted-foreground">{items.length}</span>
            </h2>
            <p className="px-2 pb-2 text-xs text-muted-foreground">{t(`roadmap.horizonHints.${h}`)}</p>
            <div className="flex min-h-20 flex-col gap-1.5">
              {items.map((p) => {
                const progress = taskProgress(index.tasksByProject.get(p.id) ?? []);
                return (
                  <article
                    key={p.id}
                    draggable
                    onDragStart={(e) => {
                      setDrag(p.id);
                      e.dataTransfer.setData("text/plain", p.id);
                    }}
                    onDragEnd={() => setDrag(null)}
                    className={cn("group rounded-xl border bg-card p-3 shadow-xs", drag === p.id && "opacity-50")}
                  >
                    <div className="flex items-start gap-1">
                      <Link href={`/scale/projects/${p.id}`} className="min-w-0 flex-1 text-sm font-medium leading-snug hover:underline">
                        {p.title}
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="rounded p-0.5 text-muted-foreground opacity-60 outline-none hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100" aria-label={t("roadmap.moveTo", { name: p.title })}>
                          <EllipsisIcon className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {HORIZONS.map((x) => (
                            <DropdownMenuItem key={x} onSelect={() => void actions.update("project", p.id, { horizon: x })}>
                              {t(`horizon.${x}`)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <HealthBadge health={p.health} />
                      {p.axis ? <span>{t(`axis.${p.axis}`)}</span> : null}
                      {p.target_date ? <span>· {dates.short(p.target_date)}</span> : null}
                    </div>
                    <ProgressBar ratio={progress.ratio} label={t("projects.tasks")} className="mt-2" />
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Objectives ─────────────────────────────────────────────────────────────

function Objectives() {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const dates = useDates();
  const [draft, setDraft] = React.useState("");
  const [kind, setKind] = React.useState<"numeric" | "validation">("validation");
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("roadmap.objectivesIntro")}</p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          const row = await actions.create("objective", { title: draft.trim(), kind });
          if (row) {
            setDraft("");
            panel.open("objective", row.id);
          }
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("roadmap.newObjective")} aria-label={t("roadmap.newObjective")} maxLength={200} className="h-9 max-w-md flex-1" />
        <Segmented value={kind} onChange={setKind} label={t("fields.kind")} options={[{ value: "validation", label: t("objective.kinds.validation") }, { value: "numeric", label: t("objective.kinds.numeric") }]} />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          <PlusIcon />
          {t("common.add")}
        </Button>
      </form>
      {index.objectives.length === 0 ? <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{t("roadmap.noObjectives")}</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {index.objectives.map((o) => {
          const projects = index.projectsByObjective.get(o.id) ?? [];
          const attainment = objectiveAttainment(o);
          const work = taskProgress(projects.flatMap((p) => index.tasksByProject.get(p.id) ?? []));
          return (
            <button key={o.id} type="button" onClick={() => panel.open("objective", o.id)} className="rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-foreground/20">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{o.title}</p>
                {o.is_focus ? <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background">{t("objective.focusBadge")}</span> : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(`objectiveStatus.${o.status}`)} · {t(`objective.kinds.${o.kind}`)}
                {o.due_date ? ` · ${dates.short(o.due_date)}` : ""}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">{t("objective.result")}</p>
                  <p className="font-medium">{o.kind === "validation" ? t(`validation.${o.validation_state}`) : attainment === null ? t("common.notFilled") : dates.percent(attainment)}</p>
                  {o.kind === "numeric" ? <ProgressBar ratio={attainment} label={t("objective.result")} tone="success" className="mt-1" /> : null}
                </div>
                <div>
                  <p className="text-muted-foreground">{t("objective.work")}</p>
                  <p className="font-medium">{work.total ? `${work.done}/${work.total}` : "—"}</p>
                  <ProgressBar ratio={work.ratio} label={t("objective.work")} className="mt-1" />
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t("roadmap.linkedProjects", { count: projects.length })}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
