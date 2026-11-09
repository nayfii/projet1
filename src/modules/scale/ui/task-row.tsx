"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArchiveIcon, CalendarClockIcon, CircleAlertIcon, CopyIcon, EllipsisIcon, RepeatIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { addDays } from "../logic/dates";
import { isClosedTask } from "../logic/planning";
import type { Task } from "../types";
import { DateField, PriorityIcon, TaskStatusMenu, useDates } from "./primitives";
import { dueTone, useIndex } from "./selectors";
import { usePanel, useScaleActions } from "./store";

/**
 * One task on one line, the same everywhere (overview, lists, project page): status, title, project,
 * date, estimate, owner. Everything changes in place; the title opens the side panel.
 */
export function TaskRow({
  task,
  showProject = true,
  selected,
  onSelect,
  className,
  dragHandle,
}: {
  task: Task;
  showProject?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  className?: string;
  dragHandle?: React.ReactNode;
}) {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const dates = useDates();
  const project = showProject && task.project_id ? index.projectById.get(task.project_id) : null;
  const owner = task.owner_id ? index.personById.get(task.owner_id) : null;
  const blocked = index.blockersOf(task.id).length > 0;
  const closed = isClosedTask(task);
  const subs = index.subtasksByParent.get(task.id) ?? [];
  const subsDone = subs.filter((s) => s.status === "done").length;

  return (
    <div
      className={cn(
        "group flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60 focus-within:bg-accent/40",
        selected && "bg-accent/70",
        panel.current?.kind === "task" && panel.current.id === task.id && "bg-accent",
        className,
      )}
    >
      {dragHandle}
      {onSelect ? <Checkbox checked={Boolean(selected)} onCheckedChange={(c) => onSelect(Boolean(c))} aria-label={t("list.select", { title: task.title })} className="opacity-60 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100" /> : null}
      <TaskStatusMenu value={task.status} onChange={(status) => void actions.update("task", task.id, { status })} compact />
      <button type="button" onClick={() => panel.open("task", task.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline">
        <span className={cn("truncate text-sm", closed && "text-muted-foreground", task.status === "done" && "line-through decoration-muted-foreground/50")}>{task.title}</span>
        {task.kind !== "task" ? <span className="hidden shrink-0 rounded-full border px-1.5 text-[11px] text-muted-foreground sm:inline">{t(`kind.${task.kind}`)}</span> : null}
        {task.recurrence ? <RepeatIcon aria-label={t(`recurrence.${task.recurrence}`)} className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        {blocked && !closed ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-destructive">
            <CircleAlertIcon className="size-3.5" />
            <span className="hidden sm:inline">{t("list.waiting")}</span>
          </span>
        ) : null}
        {subs.length ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{subsDone}/{subs.length}</span> : null}
      </button>
      {project ? <span className="hidden max-w-[11rem] shrink-0 truncate text-xs text-muted-foreground lg:inline">{project.title}</span> : null}
      {task.estimate_hours !== null ? (
        <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline" title={t("list.estimate")}>
          {`~${dates.number(Number(task.estimate_hours))} ${t("common.h")}`}
        </span>
      ) : null}
      <DateField value={task.due_date} onChange={(due_date) => void actions.update("task", task.id, { due_date })} label={t("fields.due_date")} placeholder="" tone={dueTone(task.due_date, index.today, closed)} className={cn(!task.due_date && "opacity-0 group-hover:opacity-100 focus-within:opacity-100")} />
      <span className="hidden sm:inline-flex">
        <PriorityIcon priority={task.priority} className={cn(task.priority === "none" && "opacity-0 group-hover:opacity-60")} />
      </span>
      {owner ? <Avatar name={owner.name} className="size-6 shrink-0 text-[10px]" /> : <span className="size-6 shrink-0" />}
      <TaskMenu task={task} />
    </div>
  );
}

/** Move, reschedule, duplicate or archive: the keyboard and touch alternative to drag and drop. */
export function TaskMenu({ task }: { task: Task }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="shrink-0 rounded p-1 text-muted-foreground opacity-60 outline-none transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100" aria-label={t("list.actions", { title: task.title })}>
        <EllipsisIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void actions.update("task", task.id, { week_start: index.monday })}>
          <CalendarClockIcon />
          {t("list.toThisWeek")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void actions.update("task", task.id, { week_start: index.nextMonday })}>
          <CalendarClockIcon />
          {t("list.toNextWeek")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void actions.update("task", task.id, { week_start: null })}>
          <CalendarClockIcon />
          {t("list.later")}
        </DropdownMenuItem>
        {task.due_date ? (
          <DropdownMenuItem onSelect={() => void actions.update("task", task.id, { due_date: addDays(task.due_date!, 7) })}>
            <CalendarClockIcon />
            {t("list.dueInAWeek")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void actions.duplicate("task", task.id)}>
          <CopyIcon />
          {t("panel.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void actions.archive("task", task.id, !task.archived_at)}>
          <ArchiveIcon />
          {task.archived_at ? t("panel.restore") : t("panel.archive")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
