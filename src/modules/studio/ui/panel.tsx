"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArchiveIcon, ArchiveRestoreIcon, ArrowUpRightIcon, EllipsisIcon, FileTextIcon, FlagIcon, LinkIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { dueTone } from "../logic/plan";
import { MILESTONE_STATUSES, type DocumentMeta, type MilestoneStatus, type Task, type TaskStatus } from "../types";
import { DocumentPicker, TaskPicker } from "./pickers";
import { AutoText, CategoryGlyph, CategoryMenu, ChoiceMenu, DateField, InlineText, PriorityDot, PriorityMenu, ProgressBar, RecordMenu, StatusIcon, StatusMenu, useDates, useToday } from "./primitives";
import { useShell } from "./shell";
import { useIndex, useMilestoneItems } from "./selectors";
import { usePanel, useStudio, useStudioActions } from "./store";

/**
 * The side panel: a task or a milestone opens on the right without leaving the page (its scroll and
 * filters stay). Its address can be shared; Escape closes it.
 */
export function StudioPanel() {
  const panel = usePanel();
  const t = useTranslations("studio.panel");
  const { current, close } = panel;

  React.useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog][data-state=open], [role=menu]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, close]);

  if (!current) return null;
  return (
    <aside
      key={`${current.kind}:${current.id}`}
      aria-label={t(current.kind)}
      data-testid="studio-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-2xl shadow-black/20 animate-panel-in sm:w-[30rem]"
    >
      {current.kind === "task" ? <TaskPanel id={current.id} onClose={close} /> : <MilestonePanel id={current.id} onClose={close} />}
    </aside>
  );
}

function PanelTop({ label, onClose, menu }: { label: React.ReactNode; onClose: () => void; menu?: React.ReactNode }) {
  const t = useTranslations("studio.panel");
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">{label}</span>
      {menu}
      <Button variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}

/** "Today" shows like "soon" on a date chip. */
const dateTone = (tone: ReturnType<typeof dueTone>) => (tone === "today" ? "soon" : tone);

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-2 py-0.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <div className="-ml-2 min-w-0">{children}</div>
    </div>
  );
}

function Missing({ onClose }: { onClose: () => void }) {
  const t = useTranslations("studio.panel");
  return (
    <>
      <PanelTop label={null} onClose={onClose} />
      <p className="p-6 text-sm text-muted-foreground">{t("missing")}</p>
    </>
  );
}

// ─── Task ───────────────────────────────────────────────────────────────────

function TaskPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations("studio.panel");
  const data = useStudio();
  const index = useIndex();
  const actions = useStudioActions();
  const panel = usePanel();
  const dates = useDates();
  const today = useToday();
  const milestones = useMilestoneItems();
  const task = data.tasks.find((x) => x.id === id);
  if (!task) return <Missing onClose={onClose} />;
  const status = task.status === "cancelled" ? "done" : task.status;
  const milestone = task.milestone_id ? index.milestones.get(task.milestone_id) : null;

  return (
    <>
      <PanelTop
        label={
          <>
            <StatusIcon status={status} />
            {t("task")}
          </>
        }
        onClose={onClose}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("more")}>
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  if (window.confirm(t("deleteTaskConfirm")) && (await actions.deleteTask(id))) onClose();
                }}
              >
                <Trash2Icon />
                {t("deleteTask")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="flex items-start gap-3">
          <Checkbox checked={status === "done"} onCheckedChange={(c) => void actions.setDone(id, Boolean(c))} aria-label={status === "done" ? t("reopen") : t("complete")} className="mt-2 size-5 rounded-full" />
          <InlineText value={task.title} onSave={(title) => void actions.updateTask(id, { title })} ariaLabel={t("title")} required maxLength={300} className={cn("text-xl font-semibold tracking-tight", status === "done" && "text-muted-foreground line-through")} />
        </div>

        <div className="mt-5 space-y-0.5">
          <Prop label={t("status")}>
            <StatusMenu value={status} onChange={(s: TaskStatus) => void actions.updateTask(id, { status: s })} />
          </Prop>
          <Prop label={t("priority")}>
            <PriorityMenu value={task.priority} onChange={(p) => void actions.updateTask(id, { priority: p })} />
          </Prop>
          <Prop label={t("due")}>
            <DateField value={task.due_date} onChange={(due_date) => void actions.updateTask(id, { due_date })} label={t("due")} placeholder={t("noDate")} tone={status === "done" ? null : dateTone(dueTone(task.due_date, today))} />
          </Prop>
          <Prop label={t("category")}>
            <CategoryMenu value={task.category_id} categories={data.categories} onChange={(category_id) => void actions.updateTask(id, { category_id })} />
          </Prop>
          <Prop label={t("milestone")}>
            <div className="flex min-w-0 items-center">
              <RecordMenu value={task.milestone_id} items={milestones} onChange={(milestone_id) => void actions.updateTask(id, { milestone_id })} noneLabel={t("noMilestone")} ariaLabel={t("milestone")} icon={<FlagIcon className="size-3.5 text-muted-foreground" />} />
              {milestone ? (
                <Button variant="ghost" size="icon-sm" aria-label={t("openMilestone", { title: milestone.title })} onClick={() => panel.open("milestone", milestone.id)} className="text-muted-foreground">
                  <ArrowUpRightIcon />
                </Button>
              ) : null}
            </div>
          </Prop>
        </div>

        <div className="mt-6">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("description")}</p>
          <AutoText value={task.description} onSave={(description) => void actions.updateTask(id, { description })} placeholder={t("descriptionPlaceholder")} ariaLabel={t("description")} className="-mx-2" minRows={3} />
        </div>

        <LinkedDocuments kind="task" ownerId={id} documents={index.docsOfTask(id)} />

        <p suppressHydrationWarning className="mt-8 text-xs text-muted-foreground">
          {t("created", { date: dates.relative(task.created_at) })}
          {task.completed_at ? ` · ${t("completed", { date: dates.relative(task.completed_at) })}` : ""}
        </p>
      </div>
    </>
  );
}

// ─── Milestone ──────────────────────────────────────────────────────────────

function MilestonePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations("studio.panel");
  const tm = useTranslations("studio.milestoneStatus");
  const data = useStudio();
  const index = useIndex();
  const actions = useStudioActions();
  const panel = usePanel();
  const today = useToday();
  const shell = useShell();
  const [picking, setPicking] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const milestone = data.milestones.find((m) => m.id === id);
  if (!milestone) return <Missing onClose={onClose} />;
  const progress = index.progress.get(id) ?? { done: 0, total: 0, ratio: null };
  const tasks = data.tasks.filter((x) => x.milestone_id === id && x.status !== "cancelled").sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.sort_order - b.sort_order);
  const category = milestone.category_id ? index.categories.get(milestone.category_id) : null;

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    await actions.createTask({ title, milestone_id: id, category_id: milestone!.category_id });
  }

  return (
    <>
      <PanelTop
        label={
          <>
            {category ? <CategoryGlyph icon={category.icon} className="size-3.5" /> : <FlagIcon className="size-3.5" />}
            {t("milestone")}
            {milestone.archived_at ? <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{t("archivedBadge")}</span> : null}
          </>
        }
        onClose={onClose}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("more")}>
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {milestone.archived_at ? (
                <DropdownMenuItem onSelect={() => void actions.archiveMilestone(id, false)}>
                  <ArchiveRestoreIcon />
                  {t("restore")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={async () => {
                    if (await actions.archiveMilestone(id, true)) onClose();
                  }}
                >
                  <ArchiveIcon />
                  {t("archive")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  if (window.confirm(t("deleteMilestoneConfirm")) && (await actions.deleteMilestone(id))) onClose();
                }}
              >
                <Trash2Icon />
                {t("deleteMilestone")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <InlineText value={milestone.title} onSave={(title) => void actions.updateMilestone(id, { title })} ariaLabel={t("title")} required maxLength={200} className="text-xl font-semibold tracking-tight" />

        <div className="mt-4 rounded-xl border bg-card/50 p-4">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{progress.total ? t("progress", { done: progress.done, total: progress.total }) : t("noTasksYet")}</span>
            {progress.ratio !== null ? <span className="tabular-nums text-muted-foreground">{Math.round(progress.ratio * 100)}%</span> : null}
          </div>
          <ProgressBar ratio={progress.ratio ?? 0} label={t("progressLabel")} tone={progress.ratio === 1 ? "success" : "default"} className="mt-2" />
        </div>

        <div className="mt-5 space-y-0.5">
          <Prop label={t("status")}>
            <ChoiceMenu value={milestone.status} options={MILESTONE_STATUSES} label={(s: MilestoneStatus) => tm(s)} onChange={(s) => s && void actions.updateMilestone(id, { status: s })} ariaLabel={t("status")} />
          </Prop>
          <Prop label={t("target")}>
            <DateField value={milestone.target_date} onChange={(target_date) => void actions.updateMilestone(id, { target_date })} label={t("target")} placeholder={t("toSchedule")} tone={milestone.status === "done" ? null : dueTone(milestone.target_date, today) === "overdue" ? "overdue" : null} />
          </Prop>
          <Prop label={t("category")}>
            <CategoryMenu value={milestone.category_id} categories={data.categories} onChange={(category_id) => void actions.updateMilestone(id, { category_id })} />
          </Prop>
        </div>

        <div className="mt-6">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("description")}</p>
          <AutoText value={milestone.description} onSave={(description) => void actions.updateMilestone(id, { description })} placeholder={t("milestoneDescriptionPlaceholder")} ariaLabel={t("description")} className="-mx-2" maxLength={5000} />
        </div>

        <section className="mt-6" aria-label={t("tasks")}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("tasks")}</p>
            <Button variant="ghost" size="sm" className="h-7 text-[13px] text-muted-foreground" onClick={() => setPicking(true)}>
              <LinkIcon />
              {t("linkTask")}
            </Button>
          </div>
          <ul className="space-y-0.5">
            {tasks.map((x) => (
              <MilestoneTaskRow key={x.id} task={x} onOpen={() => panel.open("task", x.id)} onDone={(done) => void actions.setDone(x.id, done)} />
            ))}
          </ul>
          <form onSubmit={addTask} className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground focus-within:bg-accent/40">
            <PlusIcon className="size-4 shrink-0" />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("addTask")} aria-label={t("addTask")} maxLength={300} className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
          </form>
        </section>

        <LinkedDocuments kind="milestone" ownerId={id} documents={index.docsOfMilestone(id)} onCreate={() => shell.create("document", { category_id: milestone.category_id, linkTo: { kind: "milestone", id } })} />
      </div>
      {picking ? (
        <TaskPicker
          exclude={tasks.map((x) => x.id)}
          onClose={() => setPicking(false)}
          onPick={async (taskId) => {
            setPicking(false);
            await actions.updateTask(taskId, { milestone_id: id });
          }}
        />
      ) : null}
    </>
  );
}

function MilestoneTaskRow({ task, onOpen, onDone }: { task: Task; onOpen: () => void; onDone: (done: boolean) => void }) {
  const t = useTranslations("studio.panel");
  const dates = useDates();
  const done = task.status === "done";
  return (
    <li className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <Checkbox checked={done} onCheckedChange={(c) => onDone(Boolean(c))} aria-label={done ? t("reopenNamed", { title: task.title }) : t("completeNamed", { title: task.title })} className="rounded-full" />
      <button type="button" onClick={onOpen} className={cn("min-w-0 flex-1 truncate text-left text-sm outline-none focus-visible:underline", done && "text-muted-foreground line-through")}>
        {task.title}
      </button>
      {task.due_date && !done ? <span className="shrink-0 text-xs text-muted-foreground">{dates.short(task.due_date)}</span> : null}
      {!done ? <PriorityDot priority={task.priority} /> : null}
    </li>
  );
}

// ─── Linked documents (task or milestone) ───────────────────────────────────

function LinkedDocuments({ kind, ownerId, documents, onCreate }: { kind: "task" | "milestone"; ownerId: string; documents: DocumentMeta[]; onCreate?: () => void }) {
  const t = useTranslations("studio.panel");
  const actions = useStudioActions();
  const shell = useShell();
  const data = useStudio();
  const [picking, setPicking] = React.useState(false);
  const owner = kind === "task" ? data.tasks.find((x) => x.id === ownerId) : null;
  return (
    <section className="mt-6" aria-label={t("documents")}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("documents")}</p>
      <ul className="space-y-1">
        {documents.map((d) => (
          <li key={d.id} className="group flex items-center gap-2 rounded-lg border bg-card/40 px-3 py-2 text-sm transition-colors hover:bg-accent/50">
            <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
            <Link href={`/studio/knowledge/${d.id}`} className="min-w-0 flex-1 truncate font-medium outline-none hover:underline focus-visible:underline">
              {d.title}
            </Link>
            {d.archived_at ? <span className="text-xs text-muted-foreground">{t("archivedBadge")}</span> : null}
            <Button variant="ghost" size="icon-sm" aria-label={t("unlinkDocument", { title: d.title })} onClick={() => void actions.linkDocument(kind, ownerId, d.id, false)} className="size-6 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100">
              <XIcon className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className={cn("flex flex-wrap gap-1", documents.length && "mt-1")}>
        <Button variant="ghost" size="sm" className="h-7 text-[13px] text-muted-foreground" onClick={() => setPicking(true)}>
          <LinkIcon />
          {t("linkDocument")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[13px] text-muted-foreground"
          onClick={() => (onCreate ? onCreate() : shell.create("document", { category_id: owner?.category_id ?? null, linkTo: { kind, id: ownerId } }))}
        >
          <PlusIcon />
          {t("newDocument")}
        </Button>
      </div>
      {picking ? (
        <DocumentPicker
          exclude={documents.map((d) => d.id)}
          onClose={() => setPicking(false)}
          onPick={(documentId) => {
            setPicking(false);
            void actions.linkDocument(kind, ownerId, documentId, true);
          }}
        />
      ) : null}
    </section>
  );
}
