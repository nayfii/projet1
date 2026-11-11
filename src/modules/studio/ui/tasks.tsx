"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarIcon, CheckIcon, ChevronRightIcon, FlagIcon, GripVerticalIcon, HistoryIcon, KanbanIcon, ListIcon, ListTodoIcon, PlusIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { addDays, weekStart } from "../logic/dates";
import { between, dueTone, filterCount, isOpen, matchesFilter, NO_CATEGORY, NO_FILTER, PRIORITY_RANK, type DueFilter, type TaskFilter } from "../logic/plan";
import { PRIORITIES, type Priority, type Task, type TaskStatus } from "../types";
import { CategoryGlyph, EmptyNote, PageHeader, PriorityDot, Segmented, StatusIcon, useCategoryName, useDates, useToday } from "./primitives";
import { useShell } from "./shell";
import { useIndex } from "./selectors";
import { usePanel, usePref, useStudio, useStudioActions } from "./store";

type View = "list" | "board" | "history";
const BOARD: TaskStatus[] = ["todo", "in_progress", "done"];

/**
 * Tasks: one list grouped by priority (drag a task to another group to change it), a board by
 * status, and the history of what is done. Adding one takes a title and Enter.
 */
export function TasksPage() {
  const t = useTranslations("studio.tasks");
  const data = useStudio();
  const shell = useShell();
  const today = useToday();
  const [view, setView] = usePref<View>("tasks-view", "list");
  const [filter, setFilter] = usePref<TaskFilter>("tasks-filter", NO_FILTER);
  const live = data.tasks.filter((x) => !x.archived_at && x.status !== "cancelled");
  const open = live.filter(isOpen);
  const shown = (view === "history" ? live.filter((x) => x.status === "done") : view === "board" ? live : open).filter((x) => matchesFilter(x, { ...filter, statuses: view === "list" ? filter.statuses : [] }, today));
  const filtered = filterCount(filter) > 0 || filter.query.trim() !== "";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <PageHeader
        title={t("title")}
        description={open.length ? t("summary", { open: open.length, high: open.filter((x) => x.priority === "high").length }) : t("summaryEmpty")}
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              label={t("views")}
              options={[
                { value: "list", label: t("list"), icon: <ListIcon /> },
                { value: "board", label: t("board"), icon: <KanbanIcon /> },
                { value: "history", label: t("history"), icon: <HistoryIcon /> },
              ]}
            />
            <Button size="sm" onClick={() => shell.create("task")}>
              <PlusIcon />
              {t("add")}
            </Button>
          </>
        }
      />

      <Filters filter={filter} onChange={setFilter} showStatus={view === "list"} />

      {live.length === 0 ? (
        <EmptyNote
          className="mt-6"
          icon={<ListTodoIcon />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Button size="sm" onClick={() => shell.create("task")}>
              <PlusIcon />
              {t("add")}
            </Button>
          }
        />
      ) : view === "list" ? (
        <ListView tasks={shown} filtered={filtered} onClear={() => setFilter(NO_FILTER)} />
      ) : view === "board" ? (
        <BoardView tasks={shown} />
      ) : (
        <HistoryView tasks={shown} />
      )}
    </div>
  );
}

// ─── Filters ────────────────────────────────────────────────────────────────

function Filters({ filter, onChange, showStatus }: { filter: TaskFilter; onChange: (f: TaskFilter) => void; showStatus: boolean }) {
  const t = useTranslations("studio.tasks");
  const tp = useTranslations("studio.priority");
  const ts = useTranslations("studio.status");
  const data = useStudio();
  const name = useCategoryName();
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chip = (active: boolean) =>
    cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", active ? "border-foreground/30 bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground");
  const dues: DueFilter[] = ["overdue", "today", "week", "none"];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <label className="flex h-8 min-w-0 flex-1 basis-48 items-center gap-2 rounded-full border px-3 text-[13px] text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:max-w-64">
        <SearchIcon className="size-3.5 shrink-0" />
        <input value={filter.query} onChange={(e) => onChange({ ...filter, query: e.target.value })} placeholder={t("search")} aria-label={t("search")} className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger className={chip(filter.priorities.length > 0)}>
          {t("filterPriority")}
          {filter.priorities.length ? <span className="tabular-nums">{`· ${filter.priorities.length}`}</span> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PRIORITIES.map((p) => (
            <DropdownMenuItem key={p} onSelect={(e) => {
                e.preventDefault();
                onChange({ ...filter, priorities: toggle(filter.priorities, p) });
              }}>
              <PriorityDot priority={p} />
              <span className="flex-1">{tp(p)}</span>
              {filter.priorities.includes(p) ? <CheckIcon /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {showStatus ? (
        <DropdownMenu>
          <DropdownMenuTrigger className={chip(filter.statuses.length > 0)}>
            {t("filterStatus")}
            {filter.statuses.length ? <span className="tabular-nums">{`· ${filter.statuses.length}`}</span> : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(["todo", "in_progress"] as const).map((s) => (
              <DropdownMenuItem key={s} onSelect={(e) => {
                e.preventDefault();
                onChange({ ...filter, statuses: toggle(filter.statuses, s) });
              }}>
                <StatusIcon status={s} />
                <span className="flex-1">{ts(s)}</span>
                {filter.statuses.includes(s) ? <CheckIcon /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger className={chip(filter.due !== null)}>
          {filter.due ? t(`due.${filter.due}`) : t("filterDue")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {dues.map((d) => (
            <DropdownMenuItem key={d} onSelect={() => onChange({ ...filter, due: filter.due === d ? null : d })}>
              <CalendarIcon />
              <span className="flex-1">{t(`due.${d}`)}</span>
              {filter.due === d ? <CheckIcon /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger className={chip(filter.categories.length > 0)}>
          {t("filterCategory")}
          {filter.categories.length ? <span className="tabular-nums">{`· ${filter.categories.length}`}</span> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {data.categories.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={(e) => {
                e.preventDefault();
                onChange({ ...filter, categories: toggle(filter.categories, c.id) });
              }}>
              <CategoryGlyph icon={c.icon} className="text-muted-foreground" />
              <span className="flex-1">{name(c)}</span>
              {filter.categories.includes(c.id) ? <CheckIcon /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => {
                e.preventDefault();
                onChange({ ...filter, categories: toggle(filter.categories, NO_CATEGORY) });
              }}>
            <span className="flex-1 text-muted-foreground">{name(null)}</span>
            {filter.categories.includes(NO_CATEGORY) ? <CheckIcon /> : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {filterCount(filter) > 0 || filter.query ? (
        <Button variant="ghost" size="sm" className="h-8 text-[13px] text-muted-foreground" onClick={() => onChange(NO_FILTER)}>
          <XIcon />
          {t("clearFilters")}
        </Button>
      ) : (
        <SlidersHorizontalIcon aria-hidden className="ml-1 size-3.5 text-muted-foreground/50" />
      )}
    </div>
  );
}

// ─── A task row (list, history, overview) ───────────────────────────────────

/**
 * ☐ Title, with only what helps: the date, the milestone, the category, "in progress". Checking it
 * strikes it through and lets it go (the list moves up softly).
 */
export function TaskRow({ task, leaving, onDone, draggable, onDragStart, onDragEnd, showPriority = false, compact = false, badge, className }: {
  task: Task;
  leaving?: boolean;
  onDone: (done: boolean) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  showPriority?: boolean;
  /** Fewer details (the Overview): no category. */
  compact?: boolean;
  /** Shown at the end of the row (why a task is in today's focus). */
  badge?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("studio.tasks");
  const index = useIndex();
  const panel = usePanel();
  const dates = useDates();
  const today = useToday();
  const name = useCategoryName();
  const done = task.status === "done" || leaving;
  const tone = done ? null : dueTone(task.due_date, today);
  const milestone = task.milestone_id ? index.milestones.get(task.milestone_id) : null;
  const category = task.category_id ? index.categories.get(task.category_id) : null;
  return (
    <div
      data-task-row={task.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group/row relative flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 transition-all duration-500 ease-[var(--ease-out-soft)] hover:bg-accent/50",
        leaving && "pointer-events-none -translate-y-0.5 opacity-0",
        className,
      )}
    >
      {draggable ? <GripVerticalIcon aria-hidden className="absolute -left-4 size-3.5 cursor-grab text-muted-foreground/60 opacity-0 transition-opacity group-hover/row:opacity-100" /> : null}
      <Checkbox
        checked={Boolean(done)}
        onCheckedChange={(c) => onDone(Boolean(c))}
        aria-label={done ? t("reopenNamed", { title: task.title }) : t("completeNamed", { title: task.title })}
        className="size-[18px] rounded-full transition-transform active:scale-90"
      />
      <button type="button" onClick={() => panel.open("task", task.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none">
        <span className={cn("min-w-0 flex-1 truncate text-[14.5px] transition-colors group-focus-visible/row:underline", done && "text-muted-foreground line-through decoration-muted-foreground/60")}>{task.title}</span>
        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground max-sm:hidden">
          {task.status === "in_progress" ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <StatusIcon status="in_progress" className="size-3.5" />
              {t("inProgress")}
            </span>
          ) : null}
          {milestone ? (
            <span className="inline-flex max-w-40 items-center gap-1 truncate">
              <FlagIcon className="size-3 shrink-0" />
              <span className="truncate">{milestone.title}</span>
            </span>
          ) : null}
          {category && !compact ? (
            <span className="inline-flex items-center gap-1">
              <CategoryGlyph icon={category.icon} className="size-3" />
              {name(category)}
            </span>
          ) : null}
        </span>
        {task.due_date ? (
          <span className={cn("shrink-0 text-xs tabular-nums", tone === "overdue" ? "text-destructive" : tone === "today" ? "text-warning" : "text-muted-foreground")}>
            {tone === "today" ? t("today") : dates.short(task.due_date)}
          </span>
        ) : null}
        {showPriority ? <PriorityDot priority={task.priority} /> : null}
        {badge}
      </button>
    </div>
  );
}

/** Rows that were just checked stay a moment, struck through, before leaving the list. */
function useLeaving() {
  const actions = useStudioActions();
  const [leaving, setLeaving] = React.useState<Set<string>>(new Set());
  const complete = React.useCallback(
    (id: string, done: boolean) => {
      if (!done) return void actions.setDone(id, false);
      setLeaving((s) => new Set(s).add(id));
      void actions.setDone(id, true);
      setTimeout(
        () =>
          setLeaving((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          }),
        650,
      );
    },
    [actions],
  );
  return { leaving, complete };
}

// ─── List: three priorities ─────────────────────────────────────────────────

function ListView({ tasks, filtered, onClear }: { tasks: Task[]; filtered: boolean; onClear: () => void }) {
  const t = useTranslations("studio.tasks");
  const tp = useTranslations("studio.priority");
  const data = useStudio();
  const actions = useStudioActions();
  const { leaving, complete } = useLeaving();
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<{ priority: Priority; before: string | null } | null>(null);
  const [collapsed, setCollapsed] = usePref<Priority[]>("tasks-collapsed", []);
  // Rows being checked stay a moment (they are done already in the data).
  const rows = [...tasks, ...data.tasks.filter((x) => leaving.has(x.id) && !tasks.some((y) => y.id === x.id))];

  if (!rows.length) {
    return filtered ? (
      <EmptyNote
        className="mt-6"
        icon={<SearchIcon />}
        title={t("noMatch")}
        action={
          <Button size="sm" variant="outline" onClick={onClear}>
            {t("clearFilters")}
          </Button>
        }
      />
    ) : (
      <EmptyNote className="mt-6" icon={<CheckIcon />} title={t("allDone")} body={t("allDoneBody")} />
    );
  }

  function drop(priority: Priority, beforeId: string | null) {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;
    const group = rows.filter((x) => x.priority === priority && x.id !== id).sort((a, b) => a.sort_order - b.sort_order);
    const at = beforeId ? group.findIndex((x) => x.id === beforeId) : group.length;
    const sort_order = between(group[at - 1]?.sort_order, group[at]?.sort_order);
    const task = data.tasks.find((x) => x.id === id);
    if (task && (task.priority !== priority || task.sort_order !== sort_order)) void actions.updateTask(id, { priority, sort_order });
  }

  return (
    <div className="space-y-6">
      {PRIORITIES.map((priority) => {
        const group = rows.filter((x) => x.priority === priority).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
        const isCollapsed = collapsed.includes(priority);
        return (
          <section
            key={priority}
            aria-label={tp(priority)}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              if (!over || over.priority !== priority) setOver({ priority, before: null });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(priority, over?.priority === priority ? over.before : null);
            }}
            className={cn("rounded-xl transition-colors", dragging && over?.priority === priority && "bg-accent/30")}
          >
            <div className="mb-1 flex items-center gap-2 px-2">
              <button
                type="button"
                onClick={() => setCollapsed((c) => (c.includes(priority) ? c.filter((x) => x !== priority) : [...c, priority]))}
                aria-expanded={!isCollapsed}
                className="flex items-center gap-2 rounded-md py-1 pr-2 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRightIcon className={cn("size-3.5 text-muted-foreground transition-transform", !isCollapsed && "rotate-90")} />
                <PriorityDot priority={priority} />
                {tp(`${priority}Group`)}
                <span className="font-normal tabular-nums text-muted-foreground">{group.filter((x) => !leaving.has(x.id)).length}</span>
              </button>
            </div>
            {isCollapsed ? null : (
              <div className="pl-2">
                {group.map((task) => (
                  <div
                    key={task.id}
                    onDragOver={(e) => {
                      if (!dragging || dragging === task.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const after = e.clientY > rect.top + rect.height / 2;
                      const next = after ? group[group.indexOf(task) + 1]?.id ?? null : task.id;
                      if (over?.priority !== priority || over.before !== next) setOver({ priority, before: next });
                    }}
                    className={cn("relative", dragging && over?.priority === priority && over.before === task.id && "before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:rounded-full before:bg-foreground/50")}
                  >
                    <TaskRow
                      task={task}
                      leaving={leaving.has(task.id)}
                      onDone={(done) => complete(task.id, done)}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", task.id);
                        setDragging(task.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      className={cn(dragging === task.id && "opacity-40")}
                    />
                  </div>
                ))}
                {dragging && over?.priority === priority && over.before === null && group.length ? <div className="mx-2 h-0.5 rounded-full bg-foreground/50" /> : null}
                <QuickAdd priority={priority} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** "+ Add" at the end of a group: Enter adds the task and keeps the field ready for the next one. */
function QuickAdd({ priority }: { priority: Priority }) {
  const t = useTranslations("studio.tasks");
  const tp = useTranslations("studio.priority");
  const actions = useStudioActions();
  const data = useStudio();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-[13px] text-muted-foreground/80 outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <PlusIcon className="size-4" />
        {t("addTo", { group: tp(`${priority}Group`) })}
      </button>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const name = title.trim();
        if (!name) return;
        setTitle("");
        const last = Math.max(0, ...data.tasks.filter((x) => x.priority === priority).map((x) => x.sort_order));
        await actions.createTask({ title: name, priority, sort_order: last + 1 });
      }}
      className="flex h-11 items-center gap-3 rounded-lg bg-accent/40 px-2"
    >
      <span aria-hidden className="size-[18px] shrink-0 rounded-full border border-dashed border-muted-foreground/50" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setTitle("");
            setOpen(false);
          }
        }}
        maxLength={300}
        placeholder={t("newTaskPlaceholder")}
        aria-label={t("newTaskIn", { group: tp(`${priority}Group`) })}
        className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted-foreground"
      />
      <span className="text-xs text-muted-foreground max-sm:hidden">{t("enterToAdd")}</span>
    </form>
  );
}

// ─── Board: three statuses ──────────────────────────────────────────────────

function BoardView({ tasks }: { tasks: Task[] }) {
  const t = useTranslations("studio.status");
  const tt = useTranslations("studio.tasks");
  const actions = useStudioActions();
  const panel = usePanel();
  const dates = useDates();
  const today = useToday();
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<TaskStatus | null>(null);
  // The board shows what was done these last two weeks; older work is in the history.
  const since = addDays(today, -14);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {BOARD.map((status) => {
        const column = tasks
          .filter((x) => x.status === status && (status !== "done" || (x.completed_at ?? "").slice(0, 10) >= since))
          .sort((a, b) => (status === "done" ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "") : PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sort_order - b.sort_order));
        return (
          <section
            key={status}
            aria-label={t(status)}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver((o) => (o === status ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragging;
              setDragging(null);
              setOver(null);
              const task = tasks.find((x) => x.id === id);
              if (id && task && task.status !== status) void (status === "done" ? actions.setDone(id, true) : actions.updateTask(id, { status }));
            }}
            className={cn("flex min-h-48 flex-col rounded-xl border bg-muted/25 p-2 transition-colors", over === status && "border-foreground/30 bg-accent/40")}
          >
            <h2 className="flex items-center gap-2 px-2 py-1.5 text-[13px] font-semibold">
              <StatusIcon status={status} />
              {t(status)}
              <span className="font-normal tabular-nums text-muted-foreground">{column.length}</span>
            </h2>
            <ul className="mt-1 flex flex-1 flex-col gap-1.5">
              {column.map((task) => {
                const tone = status === "done" ? null : dueTone(task.due_date, today);
                return (
                  <li
                    key={task.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", task.id);
                      setDragging(task.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn("cursor-grab rounded-lg border bg-card shadow-xs transition-[opacity,transform] active:cursor-grabbing", dragging === task.id && "opacity-40")}
                  >
                    <button type="button" onClick={() => panel.open("task", task.id)} className="block w-full px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className={cn("block text-sm leading-snug", status === "done" && "text-muted-foreground line-through")}>{task.title}</span>
                      <span className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <PriorityDot priority={task.priority} />
                        {task.due_date ? <span className={cn(tone === "overdue" && "text-destructive", tone === "today" && "text-warning")}>{dates.short(task.due_date)}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
              {column.length === 0 ? <li className="flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{tt("dropHere")}</li> : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ─── History: what is done ──────────────────────────────────────────────────

function HistoryView({ tasks }: { tasks: Task[] }) {
  const t = useTranslations("studio.tasks");
  const actions = useStudioActions();
  const today = useToday();
  const monday = weekStart(today);
  const sorted = [...tasks].sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at));
  if (!sorted.length) return <EmptyNote className="mt-6" icon={<HistoryIcon />} title={t("historyEmpty")} body={t("historyEmptyBody")} />;
  const groups: { key: "today" | "week" | "earlier"; rows: Task[] }[] = [
    { key: "today", rows: sorted.filter((x) => (x.completed_at ?? "").slice(0, 10) === today) },
    { key: "week", rows: sorted.filter((x) => (x.completed_at ?? "").slice(0, 10) !== today && (x.completed_at ?? "").slice(0, 10) >= monday) },
    { key: "earlier", rows: sorted.filter((x) => !x.completed_at || x.completed_at.slice(0, 10) < monday) },
  ];
  return (
    <div className="space-y-6">
      {groups
        .filter((g) => g.rows.length)
        .map((g) => (
          <section key={g.key} aria-label={t(`done.${g.key}`)}>
            <h2 className="mb-1 px-2 text-[13px] font-semibold text-muted-foreground">
              {t(`done.${g.key}`)} <span className="font-normal tabular-nums">{g.rows.length}</span>
            </h2>
            {g.rows.map((task) => (
              <TaskRow key={task.id} task={task} onDone={(done) => !done && void actions.setDone(task.id, false)} showPriority />
            ))}
          </section>
        ))}
    </div>
  );
}

