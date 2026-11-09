"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ArchiveIcon,
  BookmarkIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  InboxIcon,
  KanbanIcon,
  ListIcon,
  PlusIcon,
  UserCheckIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  XIcon,
  CheckIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addDays, monthGrid, monthOf, weekDays } from "../logic/dates";
import { isClosedTask, tasksOfWeek, weekLoad } from "../logic/planning";
import { PRIORITIES, TASK_KINDS, TASK_STATUSES, type Priority, type Task, type TaskKind, type TaskStatus } from "../types";
import { PriorityIcon, ProgressBar, TaskStatusIcon, TaskStatusMenu, useDates } from "./primitives";
import { dueTone, useIndex, type ScaleIndex } from "./selectors";
import { useShell } from "./shell";
import { usePanel, usePref, useScale, useScaleActions } from "./store";
import { TaskMenu, TaskRow } from "./task-row";

export const TASK_VIEWS = ["list", "board", "calendar", "mine", "week", "unplanned", "triage"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export type TaskFilters = {
  statuses: TaskStatus[];
  priorities: Priority[];
  owners: string[];
  projects: string[];
  kinds: TaskKind[];
  sort: "manual" | "due" | "priority" | "updated";
  showClosed: boolean;
};

export const EMPTY_FILTERS: TaskFilters = { statuses: [], priorities: [], owners: [], projects: [], kinds: [], sort: "manual", showClosed: false };
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export function applyFilters(tasks: Task[], f: TaskFilters): Task[] {
  const list = tasks.filter(
    (x) =>
      !x.parent_id &&
      (f.statuses.length ? f.statuses.includes(x.status) : f.showClosed || !isClosedTask(x)) &&
      (!f.priorities.length || f.priorities.includes(x.priority)) &&
      (!f.owners.length || f.owners.includes(x.owner_id ?? "none")) &&
      (!f.projects.length || f.projects.includes(x.project_id ?? "none")) &&
      (!f.kinds.length || f.kinds.includes(x.kind)),
  );
  const by = {
    manual: (a: Task, b: Task) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
    due: (a: Task, b: Task) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    priority: (a: Task, b: Task) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    updated: (a: Task, b: Task) => b.updated_at.localeCompare(a.updated_at),
  }[f.sort];
  return list.sort(by);
}

/** Every task view reads the same records: a change in one shows in all the others at once. */
export function TaskViews({ view, onView }: { view: TaskView; onView: (v: TaskView) => void }) {
  const t = useTranslations("scale.tasks");
  const index = useIndex();
  const [filters, setFilters] = usePref<TaskFilters>("tasks-filters", EMPTY_FILTERS);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const views: { value: TaskView; label: string; icon: React.ReactNode }[] = [
    { value: "list", label: t("views.list"), icon: <ListIcon /> },
    { value: "board", label: t("views.board"), icon: <KanbanIcon /> },
    { value: "calendar", label: t("views.calendar"), icon: <CalendarDaysIcon /> },
    { value: "mine", label: t("views.mine"), icon: <UserCheckIcon /> },
    { value: "week", label: t("views.week"), icon: <CalendarCheckIcon /> },
    { value: "unplanned", label: t("views.unplanned"), icon: <CalendarClockIcon /> },
    { value: "triage", label: t("views.triage", { count: index.tasks.filter((x) => x.status === "triage").length }), icon: <InboxIcon /> },
  ];
  const filtered = applyFilters(index.tasks, filters);
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs views={views} view={view} onView={onView} />
        {view === "list" || view === "board" || view === "calendar" ? <FilterBar filters={filters} onChange={setFilters} /> : null}
      </div>
      {selected.size ? <BulkBar ids={[...selected]} onDone={() => setSelected(new Set())} /> : null}
      {view === "list" ? <ListView tasks={filtered} selected={selected} onSelect={toggle} sorted={filters.sort !== "manual"} /> : null}
      {view === "board" ? <BoardView tasks={applyFilters(index.tasks, { ...filters, showClosed: true })} /> : null}
      {view === "calendar" ? <CalendarView tasks={filtered} /> : null}
      {view === "mine" ? <MineView /> : null}
      {view === "week" ? <WeekView /> : null}
      {view === "unplanned" ? <UnplannedView /> : null}
      {view === "triage" ? <TriageView /> : null}
    </div>
  );
}

function ViewTabs({ views, view, onView }: { views: { value: TaskView; label: string; icon: React.ReactNode }[]; view: TaskView; onView: (v: TaskView) => void }) {
  const t = useTranslations("scale.tasks");
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={t("viewsLabel")} className="-mx-1 flex max-w-full gap-0.5 overflow-x-auto px-1 pb-0.5">
      {views.map((v, i) => (
        <button
          key={v.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          type="button"
          aria-selected={view === v.value}
          tabIndex={view === v.value ? 0 : -1}
          onClick={() => onView(v.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const n = (i + (e.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
            onView(views[n].value);
            refs.current[n]?.focus();
          }}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
            view === v.value ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          {v.icon}
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ─── Filters and saved views ────────────────────────────────────────────────

function FilterBar({ filters, onChange }: { filters: TaskFilters; onChange: (f: TaskFilters) => void }) {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const views = data.views.filter((v) => v.section === "tasks");
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState("");
  const active = filters.statuses.length + filters.priorities.length + filters.owners.length + filters.projects.length + filters.kinds.length;
  const toggleIn = <K extends "statuses" | "priorities" | "owners" | "projects" | "kinds">(key: K, value: TaskFilters[K][number]) => {
    const list = filters[key] as string[];
    onChange({ ...filters, [key]: list.includes(value as string) ? list.filter((x) => x !== value) : [...list, value] });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8">
            {t("filters.filter")}
            {active ? <span className="rounded-full bg-foreground px-1.5 text-[11px] text-background">{active}</span> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("fields.status")}</DropdownMenuLabel>
          {TASK_STATUSES.map((s) => (
            <DropdownMenuCheckboxItem key={s} checked={filters.statuses.includes(s)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleIn("statuses", s)}>
              <TaskStatusIcon status={s} />
              {t(`taskStatus.${s}`)}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("fields.priority")}</DropdownMenuLabel>
          {PRIORITIES.map((p) => (
            <DropdownMenuCheckboxItem key={p} checked={filters.priorities.includes(p)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleIn("priorities", p)}>
              <PriorityIcon priority={p} />
              {t(`priority.${p}`)}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("fields.owner_id")}</DropdownMenuLabel>
          {[...data.team.map((m) => ({ id: m.id, name: m.name })), { id: "none", name: t("common.noOwner") }].map((m) => (
            <DropdownMenuCheckboxItem key={m.id} checked={filters.owners.includes(m.id)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleIn("owners", m.id)}>
              {m.name}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("fields.project_id")}</DropdownMenuLabel>
          {[...index.projects.map((p) => ({ id: p.id, name: p.title })), { id: "none", name: t("panel.noProject") }].map((p) => (
            <DropdownMenuCheckboxItem key={p.id} checked={filters.projects.includes(p.id)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleIn("projects", p.id)}>
              <span className="truncate">{p.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("fields.kind")}</DropdownMenuLabel>
          {TASK_KINDS.map((k) => (
            <DropdownMenuCheckboxItem key={k} checked={filters.kinds.includes(k)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleIn("kinds", k)}>
              {t(`kind.${k}`)}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={filters.showClosed} onSelect={(e) => e.preventDefault()} onCheckedChange={(c) => onChange({ ...filters, showClosed: Boolean(c) })}>
            {t("filters.showClosed")}
          </DropdownMenuCheckboxItem>
          {active ? (
            <DropdownMenuItem onSelect={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}>
              <XIcon />
              {t("filters.clear")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8">
            {t(`filters.sorts.${filters.sort}`)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(["manual", "due", "priority", "updated"] as const).map((s) => (
            <DropdownMenuItem key={s} onSelect={() => onChange({ ...filters, sort: s })}>
              <span className="flex-1">{t(`filters.sorts.${s}`)}</span>
              {filters.sort === s ? <CheckIcon /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu onOpenChange={(o) => !o && setNaming(false)}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8" aria-label={t("filters.saved")}>
            <BookmarkIcon />
            <span className="hidden sm:inline">{t("filters.saved")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {views.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">{t("filters.noSaved")}</p> : null}
          {views.map((v) => (
            <DropdownMenuItem key={v.id} onSelect={() => onChange({ ...EMPTY_FILTERS, ...(v.config as Partial<TaskFilters>) })} className="group">
              <BookmarkIcon />
              <span className="flex-1 truncate">{v.name}</span>
              <button
                type="button"
                aria-label={t("filters.deleteSaved", { name: v.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void actions.deleteView(v.id);
                }}
                className="rounded p-0.5 opacity-0 hover:bg-background group-hover:opacity-100 group-focus:opacity-100"
              >
                <XIcon className="size-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {naming ? (
            <form
              className="flex gap-1 p-1"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                if (await actions.saveView({ section: "tasks", name: name.trim(), config: filters as unknown as Record<string, unknown> })) {
                  setName("");
                  setNaming(false);
                }
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} maxLength={80} placeholder={t("filters.viewName")} aria-label={t("filters.viewName")} className="h-8 text-[13px]" autoFocus />
              <Button type="submit" size="sm" className="h-8">
                {t("filters.save")}
              </Button>
            </form>
          ) : (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setNaming(true);
              }}
            >
              <PlusIcon />
              {t("filters.saveCurrent")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Bulk actions ───────────────────────────────────────────────────────────

function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const apply = async (patch: Record<string, unknown>) => {
    if (await actions.bulkUpdate(ids, patch)) onDone();
  };
  const menu = (label: string, items: { key: string; label: React.ReactNode; patch: Record<string, unknown> }[]) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 text-background hover:bg-background/15 hover:text-background">
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {items.map((i) => (
          <DropdownMenuItem key={i.key} onSelect={() => void apply(i.patch)}>
            {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div role="toolbar" aria-label={t("bulk.label")} className="sticky top-16 z-20 flex flex-wrap items-center gap-1 rounded-xl bg-foreground px-3 py-1.5 text-background shadow-lg md:top-3 animate-in fade-in-0 slide-in-from-bottom-2">
      <span className="mr-2 text-sm font-medium">{t("bulk.selected", { count: ids.length })}</span>
      {menu(t("fields.status"), TASK_STATUSES.map((s) => ({ key: s, label: <><TaskStatusIcon status={s} /> {t(`taskStatus.${s}`)}</>, patch: { status: s } })))}
      {menu(t("fields.priority"), PRIORITIES.map((p) => ({ key: p, label: <><PriorityIcon priority={p} /> {t(`priority.${p}`)}</>, patch: { priority: p } })))}
      {menu(t("fields.owner_id"), [...data.team.map((m) => ({ key: m.id, label: m.name, patch: { owner_id: m.id } })), { key: "none", label: t("common.noOwner"), patch: { owner_id: null } }])}
      {menu(t("fields.week_start"), [
        { key: "this", label: t("week.this"), patch: { week_start: index.monday } },
        { key: "next", label: t("week.next"), patch: { week_start: index.nextMonday } },
        { key: "none", label: t("week.none"), patch: { week_start: null } },
      ])}
      {menu(t("fields.project_id"), [...index.projects.map((p) => ({ key: p.id, label: p.title, patch: { project_id: p.id } })), { key: "none", label: t("panel.noProject"), patch: { project_id: null } }])}
      <Button
        size="sm"
        variant="ghost"
        className="h-8 text-background hover:bg-background/15 hover:text-background"
        onClick={async () => {
          if (await actions.bulkArchive(ids, true)) onDone();
        }}
      >
        <ArchiveIcon />
        {t("panel.archive")}
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={t("bulk.clear")} className="ml-auto text-background hover:bg-background/15 hover:text-background" onClick={onDone}>
        <XIcon />
      </Button>
    </div>
  );
}

// ─── List (grouped by status) ───────────────────────────────────────────────

function ListView({ tasks, selected, onSelect, sorted }: { tasks: Task[]; selected: Set<string>; onSelect: (id: string, on: boolean) => void; sorted: boolean }) {
  const t = useTranslations("scale");
  const shell = useShell();
  const actions = useScaleActions();
  const [drag, setDrag] = React.useState<string | null>(null);
  if (!tasks.length) return <EmptyView text={t("tasks.emptyList")} onAdd={() => shell.capture()} />;
  const groups = TASK_STATUSES.map((s) => ({ status: s, items: tasks.filter((x) => x.status === s) })).filter((g) => g.items.length);
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.status} aria-label={t(`taskStatus.${g.status}`)}>
          <h3 className="mb-1 flex items-center gap-2 px-2 text-[13px] font-medium text-muted-foreground">
            <TaskStatusIcon status={g.status} />
            {t(`taskStatus.${g.status}`)}
            <span className="tabular-nums">{g.items.length}</span>
          </h3>
          <div className="space-y-0.5">
            {g.items.map((task, i) => (
              <div
                key={task.id}
                onDragOver={(e) => {
                  if (drag && drag !== task.id && !sorted) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!drag || drag === task.id) return;
                  // Dropped above this task: placed between it and the one before.
                  const prev = g.items[i - 1];
                  const order = prev ? (prev.sort_order + task.sort_order) / 2 : task.sort_order - 1;
                  void actions.update("task", drag, { sort_order: order, ...(g.status !== tasks.find((x) => x.id === drag)?.status ? { status: g.status } : {}) });
                  setDrag(null);
                }}
              >
                <TaskRow
                  task={task}
                  selected={selected.has(task.id)}
                  onSelect={(on) => onSelect(task.id, on)}
                  dragHandle={
                    sorted ? undefined : (
                      <span
                        draggable
                        onDragStart={(e) => {
                          setDrag(task.id);
                          e.dataTransfer.setData("text/plain", task.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDrag(null)}
                        aria-hidden
                        className="hidden cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing sm:inline"
                      >
                        <GripVerticalIcon className="size-4" />
                      </span>
                    )
                  }
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EmptyView({ text, onAdd, addLabel }: { text: string; onAdd?: () => void; addLabel?: string }) {
  const t = useTranslations("scale.tasks");
  return (
    <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {onAdd ? (
        <Button size="sm" variant="outline" className="mt-4" onClick={onAdd}>
          <PlusIcon />
          {addLabel ?? t("add")}
        </Button>
      ) : null}
    </div>
  );
}

// ─── Kanban ─────────────────────────────────────────────────────────────────

function BoardView({ tasks }: { tasks: Task[] }) {
  const t = useTranslations("scale");
  const actions = useScaleActions();
  const shell = useShell();
  const [drag, setDrag] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<TaskStatus | null>(null);
  const columns: TaskStatus[] = ["triage", "todo", "in_progress", "blocked", "done"];
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
      <div className="flex min-w-max gap-3">
        {columns.map((status) => {
          const items = tasks.filter((x) => x.status === status);
          return (
            <section
              key={status}
              aria-label={t(`taskStatus.${status}`)}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((o) => (o === status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = drag ?? e.dataTransfer.getData("text/plain");
                setDrag(null);
                setOver(null);
                if (id && tasks.find((x) => x.id === id)?.status !== status) void actions.update("task", id, { status });
              }}
              className={cn("flex w-[17rem] shrink-0 flex-col rounded-2xl bg-muted/40 p-2 transition-colors", over === status && "bg-accent ring-2 ring-ring/30")}
            >
              <header className="flex items-center gap-2 px-2 py-1.5 text-[13px] font-medium">
                <TaskStatusIcon status={status} />
                {t(`taskStatus.${status}`)}
                <span className="tabular-nums text-muted-foreground">{items.length}</span>
                <button type="button" aria-label={t("tasks.addIn", { status: t(`taskStatus.${status}`) })} onClick={() => shell.capture({ status: status === "done" ? "todo" : status })} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
                  <PlusIcon className="size-4" />
                </button>
              </header>
              <div className="flex min-h-24 flex-col gap-1.5">
                {items.map((task) => (
                  <BoardCard key={task.id} task={task} dragging={drag === task.id} onDragStart={() => setDrag(task.id)} onDragEnd={() => setDrag(null)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({ task, dragging, onDragStart, onDragEnd }: { task: Task; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const panel = usePanel();
  const actions = useScaleActions();
  const dates = useDates();
  const project = task.project_id ? index.projectById.get(task.project_id) : null;
  const owner = task.owner_id ? index.personById.get(task.owner_id) : null;
  const tone = dueTone(task.due_date, index.today, isClosedTask(task));
  const waiting = index.blockersOf(task.id).length > 0;
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn("group rounded-xl border bg-card p-3 shadow-xs transition-[box-shadow,opacity,border-color] hover:border-foreground/20 hover:shadow-sm", dragging && "opacity-50")}
    >
      <div className="flex items-start gap-1.5">
        <button type="button" onClick={() => panel.open("task", task.id)} className="min-w-0 flex-1 text-left text-sm leading-snug outline-none focus-visible:underline">
          {task.title}
        </button>
        <TaskMenu task={task} />
      </div>
      {project ? <p className="mt-1 truncate text-xs text-muted-foreground">{project.title}</p> : null}
      <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
        <TaskStatusMenu value={task.status} onChange={(status) => void actions.update("task", task.id, { status })} compact />
        <PriorityIcon priority={task.priority} />
        {task.due_date ? <span className={cn(tone === "overdue" && "text-destructive", tone === "soon" && "text-warning")}>{dates.short(task.due_date)}</span> : null}
        {waiting ? <span className="text-destructive">{t("list.waiting")}</span> : null}
        {task.estimate_hours !== null ? <span className="tabular-nums">{`~${dates.number(Number(task.estimate_hours))} ${t("common.h")}`}</span> : null}
        <span className="ml-auto">{owner ? <Avatar name={owner.name} className="size-5 text-[9px]" /> : null}</span>
      </div>
    </article>
  );
}

// ─── Calendar (by due date) ─────────────────────────────────────────────────

function CalendarView({ tasks }: { tasks: Task[] }) {
  const t = useTranslations("scale.tasks");
  const index = useIndex();
  const actions = useScaleActions();
  const shell = useShell();
  const panel = usePanel();
  const dates = useDates();
  const [month, setMonth] = usePref("calendar-month", monthOf(index.today));
  const days = monthGrid(month.year, month.month);
  const [drag, setDrag] = React.useState<string | null>(null);
  const firstOfMonth = `${month.year}-${String(month.month + 1).padStart(2, "0")}-01`;
  const undated = tasks.filter((x) => !x.due_date).length;
  const shift = (n: number) => {
    const d = new Date(Date.UTC(month.year, month.month + n, 1));
    setMonth({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-2 text-lg font-semibold capitalize">{dates.monthYear(firstOfMonth)}</h3>
        <Button size="icon-sm" variant="ghost" aria-label={t("prevMonth")} onClick={() => shift(-1)}>
          <ChevronLeftIcon />
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setMonth(monthOf(index.today))}>
          {t("today")}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={t("nextMonth")} onClick={() => shift(1)}>
          <ChevronRightIcon />
        </Button>
        {undated ? <span className="ml-auto text-xs text-muted-foreground">{t("undated", { count: undated })}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-2xl border">
          {weekDays(days[0]).map((d) => (
            <div key={d} className="border-b bg-muted/40 px-2 py-1.5 text-xs font-medium capitalize text-muted-foreground">
              {dates.weekday(d)}
            </div>
          ))}
          {days.map((d) => {
            const inMonth = d.slice(5, 7) === String(month.month + 1).padStart(2, "0");
            const items = tasks.filter((x) => x.due_date === d);
            return (
              <div
                key={d}
                onDragOver={(e) => drag && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = drag ?? e.dataTransfer.getData("text/plain");
                  setDrag(null);
                  if (id) void actions.update("task", id, { due_date: d });
                }}
                className={cn("group/day min-h-24 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/25 text-muted-foreground")}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("flex size-6 items-center justify-center rounded-full text-xs tabular-nums", d === index.today && "bg-foreground font-semibold text-background")}>{Number(d.slice(8))}</span>
                  <button type="button" aria-label={t("addOn", { date: dates.long(d) })} onClick={() => shell.capture({ dueDate: d })} className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover/day:opacity-100">
                    <PlusIcon className="size-3.5" />
                  </button>
                </div>
                <div className="mt-1 space-y-0.5">
                  {items.slice(0, 4).map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        setDrag(x.id);
                        e.dataTransfer.setData("text/plain", x.id);
                      }}
                      onDragEnd={() => setDrag(null)}
                      onClick={() => panel.open("task", x.id)}
                      className={cn("flex w-full items-center gap-1 truncate rounded-md bg-card px-1.5 py-0.5 text-left text-[12px] shadow-xs ring-1 ring-border hover:ring-foreground/30", x.status === "done" && "text-muted-foreground line-through")}
                    >
                      <TaskStatusIcon status={x.status} className="size-3" />
                      <span className="truncate">{x.title}</span>
                    </button>
                  ))}
                  {items.length > 4 ? <span className="block px-1 text-[11px] text-muted-foreground">{t("more", { count: items.length - 4 })}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("calendarHint")}</p>
    </div>
  );
}

// ─── My work ────────────────────────────────────────────────────────────────

function MineView() {
  const t = useTranslations("scale.tasks");
  const data = useScale();
  const index = useIndex();
  const shell = useShell();
  const mine = index.openTasks.filter((x) => x.owner_id === data.meId && !x.parent_id).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const groups = [
    { key: "overdue", items: mine.filter((x) => x.due_date && x.due_date < index.today) },
    { key: "thisWeek", items: mine.filter((x) => !(x.due_date && x.due_date < index.today) && (x.week_start === index.monday || (x.due_date && x.due_date < index.nextMonday))) },
    { key: "later", items: mine.filter((x) => !(x.due_date && x.due_date < index.nextMonday) && x.week_start !== index.monday && (x.due_date || x.week_start)) },
    { key: "undated", items: mine.filter((x) => !x.due_date && !x.week_start) },
  ];
  if (!mine.length) return <EmptyView text={t("mineEmpty")} onAdd={() => shell.capture()} />;
  return <Grouped groups={groups} />;
}

function Grouped({ groups }: { groups: { key: string; items: Task[] }[] }) {
  const t = useTranslations("scale.tasks.groups");
  return (
    <div className="space-y-5">
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.key} aria-label={t(g.key as Parameters<typeof t>[0])}>
            <h3 className={cn("mb-1 px-2 text-[13px] font-medium", g.key === "overdue" ? "text-destructive" : "text-muted-foreground")}>
              {t(g.key as Parameters<typeof t>[0])} <span className="tabular-nums">{g.items.length}</span>
            </h3>
            <div className="space-y-0.5">
              {g.items.map((x) => (
                <TaskRow key={x.id} task={x} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

// ─── This week (by day, with the capacity) ──────────────────────────────────

export function WeekView() {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const shell = useShell();
  const dates = useDates();
  const [monday, setMonday] = React.useState(index.monday);
  const capacity = index.capacityFor(monday);
  const load = weekLoad(data.tasks.filter((x) => !x.parent_id), monday, capacity);
  const week = tasksOfWeek(index.tasks.filter((x) => !x.parent_id), monday);
  const days = weekDays(monday);
  const noDay = week.filter((x) => !x.due_date || !days.includes(x.due_date));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label={t("tasks.prevWeek")} onClick={() => setMonday(addDays(monday, -7))}>
          <ChevronLeftIcon />
        </Button>
        <span className="text-sm font-medium">{t("overview.week.range", { from: dates.short(monday), to: dates.short(addDays(monday, 6)) })}</span>
        <Button size="icon-sm" variant="ghost" aria-label={t("tasks.nextWeek")} onClick={() => setMonday(addDays(monday, 7))}>
          <ChevronRightIcon />
        </Button>
        {monday !== index.monday ? (
          <Button size="sm" variant="outline" className="h-8" onClick={() => setMonday(index.monday)}>
            {t("tasks.thisWeek")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => shell.capture({ weekStart: monday })}>
          <PlusIcon />
          {t("overview.week.add")}
        </Button>
      </div>
      <CapacityBar load={load} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[...days.slice(0, 5).map((d) => ({ key: d, label: `${dates.weekday(d)} ${dates.short(d)}`, items: week.filter((x) => x.due_date === d) })), { key: "noday", label: t("tasks.groups.noDay"), items: noDay }].map((col) => (
          <section key={col.key} className={cn("rounded-2xl border p-2", col.key === index.today && "border-foreground/30")}>
            <h3 className="px-2 py-1 text-[13px] font-medium capitalize">
              {col.label} <span className="tabular-nums text-muted-foreground">{col.items.length}</span>
            </h3>
            <div className="space-y-0.5">
              {col.items.map((x) => (
                <TaskRow key={x.id} task={x} showProject={false} />
              ))}
              {col.items.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">—</p> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function CapacityBar({ load }: { load: ReturnType<typeof weekLoad> }) {
  const t = useTranslations("scale.overview.week");
  const dates = useDates();
  const ratio = load.capacity ? Math.min(1, load.planned / load.capacity) : null;
  return (
    <div className="rounded-xl bg-muted/50 p-3.5">
      <p className="text-sm">
        {t("planned", { hours: dates.number(load.planned) })}
        {load.capacity !== null ? <span className="text-muted-foreground"> / {t("capacity", { hours: dates.number(load.capacity) })}</span> : <span className="text-muted-foreground"> · {t("noCapacity")}</span>}
      </p>
      <ProgressBar ratio={ratio} label={t("loadLabel")} className={cn("mt-2", load.over ? "[&>div]:bg-destructive" : "")} />
      <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        {load.over ? <span className="font-medium text-destructive">{t("over", { hours: dates.number(load.over) })}</span> : null}
        {load.unestimated ? <span>{t("unestimated", { count: load.unestimated })}</span> : null}
        <span>{t("estimatesNote")}</span>
      </p>
    </div>
  );
}

// ─── To plan, to sort ───────────────────────────────────────────────────────

function UnplannedView() {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const items = index.openTasks.filter((x) => !x.parent_id && x.status !== "triage" && !x.week_start && !x.due_date);
  if (!items.length) return <EmptyView text={t("tasks.unplannedEmpty")} />;
  return (
    <div className="space-y-0.5">
      <p className="mb-3 text-sm text-muted-foreground">{t("tasks.unplannedHint")}</p>
      {items.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center gap-1">
          <TaskRow task={x} className="min-w-0 flex-1" />
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void actions.update("task", x.id, { week_start: index.monday })}>
            {t("week.this")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void actions.update("task", x.id, { week_start: index.nextMonday })}>
            {t("week.next")}
          </Button>
        </div>
      ))}
    </div>
  );
}

function TriageView() {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const shell = useShell();
  const items = index.tasks.filter((x) => x.status === "triage" && !x.parent_id);
  if (!items.length) return <EmptyView text={t("tasks.triageEmpty")} onAdd={() => shell.capture({ kind: "idea" })} addLabel={t("tasks.addIdea")} />;
  return (
    <div className="space-y-0.5">
      <p className="mb-3 text-sm text-muted-foreground">{t("tasks.triageHint")}</p>
      {items.map((x) => (
        <TriageRow key={x.id} task={x} index={index} actions={actions} />
      ))}
    </div>
  );
}

function TriageRow({ task, index, actions }: { task: Task; index: ScaleIndex; actions: ReturnType<typeof useScaleActions> }) {
  const t = useTranslations("scale");
  return (
    <div className="flex flex-wrap items-center gap-1">
      <TaskRow task={task} className="min-w-0 flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 text-xs">
            {t("tasks.toProject")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          {index.projects.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => void actions.update("task", task.id, { project_id: p.id, status: "todo", kind: task.kind === "idea" ? "task" : task.kind })}>
              {p.title}
            </DropdownMenuItem>
          ))}
          {index.projects.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">{t("tasks.noProjects")}</p> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void actions.update("task", task.id, { status: "todo", kind: task.kind === "idea" ? "task" : task.kind })}>
        {t("tasks.accept")}
      </Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => void actions.update("task", task.id, { status: "cancelled" })}>
        {t("tasks.drop")}
      </Button>
    </div>
  );
}
