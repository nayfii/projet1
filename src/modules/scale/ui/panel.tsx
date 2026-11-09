"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BuildingIcon,
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  EllipsisIcon,
  FlagIcon,
  GitBranchIcon,
  LinkIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { addDays, weekStart } from "../logic/dates";
import { isClosedTask, objectiveAttainment, priorityScore, taskProgress, wouldCreateCycle } from "../logic/planning";
import {
  COMMERCIAL_URGENCIES,
  DECISION_STATUSES,
  OBJECTIVE_KINDS,
  OBJECTIVE_STATUSES,
  PRODUCT_KINDS,
  RECURRENCES,
  TASK_KINDS,
  VALIDATION_STATES,
  type Decision,
  type Entity,
  type Milestone,
  type Objective,
  type Task,
} from "../types";
import { CompanyConsoleLink, CompanyLinks, EntityExtras } from "./details";
import { AutoText, ChoiceMenu, DateField, Field, InlineText, NumberField, PersonMenu, PriorityMenu, ProgressBar, RecordMenu, SectionTitle, TaskStatusIcon, TaskStatusMenu, useDates } from "./primitives";
import { useReschedule } from "./reschedule";
import { dueTone, useIndex } from "./selectors";
import { usePanel, useScale, useScaleActions } from "./store";

/**
 * The side panel: a task, an objective, a milestone, a decision or a customer company opens on the
 * right without leaving the page (its position and filters stay). It can be widened to full screen,
 * and its address can be shared.
 */
export function ScalePanel() {
  const panel = usePanel();
  const t = useTranslations("scale.panel");
  const ref = React.useRef<HTMLDivElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const key = panel.current ? `${panel.current.kind}:${panel.current.id}` : null;

  React.useEffect(() => {
    if (!key) return;
    returnFocus.current = (document.activeElement as HTMLElement) ?? null;
    ref.current?.focus();
    const back = returnFocus;
    return () => back.current?.focus?.();
  }, [key]);

  React.useEffect(() => {
    if (!key) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[role=dialog]:not([data-scale-panel]),[role=menu],[role=listbox]")) return;
      panel.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, panel]);

  if (!panel.current) return null;
  const { kind, id } = panel.current;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal={false}
      data-scale-panel
      aria-label={t(`kinds.${kind}`)}
      className={cn(
        "fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-2xl outline-none animate-in slide-in-from-right-8 fade-in-0 duration-200",
        panel.full ? "md:left-[15.5rem]" : "sm:w-[36rem]",
      )}
    >
      {kind === "task" ? <TaskPanel id={id} /> : kind === "objective" ? <ObjectivePanel id={id} /> : kind === "milestone" ? <MilestonePanel id={id} /> : kind === "decision" ? <DecisionPanel id={id} /> : <CompanyPanel id={id} />}
    </div>
  );
}

function PanelFrame({
  crumbs,
  entity,
  id,
  archived,
  children,
  extraMenu,
}: {
  crumbs: React.ReactNode;
  entity?: Entity;
  id: string;
  archived?: boolean;
  children: React.ReactNode;
  extraMenu?: React.ReactNode;
}) {
  const t = useTranslations("scale.panel");
  const panel = usePanel();
  const actions = useScaleActions();
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <div className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{crumbs}</div>
        <Button variant="ghost" size="icon-sm" aria-label={panel.full ? t("exitFull") : t("full")} onClick={panel.toggleFull} className="hidden md:inline-flex">
          {panel.full ? <Minimize2Icon /> : <Maximize2Icon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("copyLink")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              toast.success(t("linkCopied"));
            } catch {
              toast.error(t("copyFailed"));
            }
          }}
        >
          <LinkIcon />
        </Button>
        {entity ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("more")}>
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {extraMenu}
              {entity === "task" || entity === "objective" || entity === "decision" ? (
                <DropdownMenuItem
                  onSelect={async () => {
                    const newId = await actions.duplicate(entity, id);
                    if (newId && (entity === "task" || entity === "objective" || entity === "decision")) panel.open(entity, newId);
                  }}
                >
                  <CopyIcon />
                  {t("duplicate")}
                </DropdownMenuItem>
              ) : null}
              {archived ? (
                <>
                  <DropdownMenuItem onSelect={() => void actions.archive(entity, id, false)}>
                    <ArchiveRestoreIcon />
                    {t("restore")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    onSelect={async () => {
                      if (window.confirm(t("deleteConfirm")) && (await actions.remove(entity, id))) panel.close();
                    }}
                  >
                    <Trash2Icon />
                    {t("delete")}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={() => void actions.archive(entity, id, true)}>
                  <ArchiveIcon />
                  {t("archive")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label={t("close")} onClick={panel.close}>
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto space-y-6 px-5 py-5", panel.full ? "max-w-3xl sm:px-8 sm:py-8" : "")}>
          {archived ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <ArchiveIcon className="size-4" />
              <span className="flex-1">{t("archivedNotice")}</span>
              {entity ? (
                <Button size="sm" variant="outline" onClick={() => void actions.archive(entity, id, false)}>
                  {t("restore")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </>
  );
}

function Missing() {
  const t = useTranslations("scale.panel");
  const panel = usePanel();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">{t("missing")}</p>
      <Button size="sm" variant="outline" onClick={panel.close}>
        {t("close")}
      </Button>
    </div>
  );
}

// ─── Task ───────────────────────────────────────────────────────────────────

function TaskPanel({ id }: { id: string }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const data = useScale();
  const actions = useScaleActions();
  const panel = usePanel();
  const router = useRouter();
  const reschedule = useReschedule();
  const task = data.tasks.find((x) => x.id === id);
  if (!task) return <Missing />;
  const set = (patch: Partial<Task>) => void actions.update("task", task.id, patch);
  const project = task.project_id ? index.projectById.get(task.project_id) : null;
  const milestone = task.milestone_id ? index.milestoneById.get(task.milestone_id) : null;
  const parent = task.parent_id ? index.taskById.get(task.parent_id) : null;
  const subtasks = (index.subtasksByParent.get(task.id) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const blockers = index.blockersOf(task.id);
  const product = (PRODUCT_KINDS as readonly string[]).includes(task.kind);
  const score = priorityScore(task);

  return (
    <PanelFrame
      entity="task"
      id={task.id}
      archived={Boolean(task.archived_at)}
      crumbs={
        <span className="flex items-center gap-1.5">
          {project ? (
            <Link href={`/scale/projects/${project.id}`} className="truncate hover:text-foreground">
              {project.title}
            </Link>
          ) : (
            <span>{t("panel.noProject")}</span>
          )}
          {milestone ? (
            <>
              <span aria-hidden>{"›"}</span>
              <button type="button" className="truncate hover:text-foreground" onClick={() => panel.open("milestone", milestone.id)}>
                {milestone.title}
              </button>
            </>
          ) : null}
          {parent ? (
            <>
              <span aria-hidden>{"›"}</span>
              <button type="button" className="truncate hover:text-foreground" onClick={() => panel.open("task", parent.id)}>
                {parent.title}
              </button>
            </>
          ) : null}
        </span>
      }
    >
      <div className="flex items-start gap-2">
        <span className="pt-1.5">
          <TaskStatusMenu value={task.status} onChange={(status) => set({ status })} compact />
        </span>
        <InlineText value={task.title} onSave={(title) => set({ title })} required ariaLabel={t("fields.title")} className="text-xl font-semibold tracking-tight" />
      </div>

      {blockers.length ? (
        <div className="flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{t("panel.waitingFor", { names: blockers.map((b) => b.title).join(", ") })}</span>
        </div>
      ) : null}

      <div className="space-y-0.5">
        <Field label={t("fields.status")}>
          <TaskStatusMenu value={task.status} onChange={(status) => set({ status })} />
        </Field>
        {task.status === "blocked" ? (
          <Field label={t("fields.blocked_reason")}>
            <AutoText value={task.blocked_reason} onSave={(blocked_reason) => set({ blocked_reason })} ariaLabel={t("fields.blocked_reason")} placeholder={t("panel.blockedReasonHint")} minRows={1} maxLength={1000} />
          </Field>
        ) : null}
        <Field label={t("fields.priority")}>
          <PriorityMenu value={task.priority} onChange={(priority) => set({ priority })} />
        </Field>
        <Field label={t("fields.owner_id")}>
          <PersonMenu value={task.owner_id} team={data.team} onChange={(owner_id) => set({ owner_id })} />
        </Field>
        <Field label={t("fields.project_id")}>
          <RecordMenu value={task.project_id} items={index.projects.map((p) => ({ id: p.id, label: p.title }))} onChange={(project_id) => set({ project_id, milestone_id: null })} noneLabel={t("panel.noProject")} ariaLabel={t("fields.project_id")} />
        </Field>
        {task.project_id ? (
          <Field label={t("fields.milestone_id")}>
            <RecordMenu value={task.milestone_id} items={(index.milestonesByProject.get(task.project_id) ?? []).map((m) => ({ id: m.id, label: m.title }))} onChange={(milestone_id) => set({ milestone_id })} noneLabel={t("panel.noMilestone")} ariaLabel={t("fields.milestone_id")} />
          </Field>
        ) : null}
        <Field label={t("fields.week_start")} hint={t("panel.weekHint")}>
          <WeekPicker value={task.week_start} onChange={(week_start) => set({ week_start })} />
        </Field>
        <Field label={t("panel.dates")}>
          <div className="flex flex-wrap items-center gap-1">
            <DateField value={task.start_date} onChange={(start) => reschedule("task", task.id, { start, end: task.due_date })} label={t("fields.start_date")} placeholder={t("fields.start_date")} />
            <span className="text-muted-foreground">{"→"}</span>
            <DateField value={task.due_date} onChange={(end) => reschedule("task", task.id, { start: task.start_date, end })} label={t("fields.due_date")} placeholder={t("fields.due_date")} tone={dueTone(task.due_date, index.today, isClosedTask(task))} min={task.start_date} />
          </div>
        </Field>
        <Field label={t("fields.estimate_hours")} hint={t("panel.estimateHint")}>
          <NumberField value={task.estimate_hours === null ? null : Number(task.estimate_hours)} onSave={(estimate_hours) => set({ estimate_hours })} ariaLabel={t("fields.estimate_hours")} placeholder="—" suffix={t("common.hours")} min={0} max={1000} />
        </Field>
        <Field label={t("fields.kind")}>
          <ChoiceMenu value={task.kind} options={TASK_KINDS} label={(k) => t(`kind.${k}`)} onChange={(kind) => kind && set({ kind })} ariaLabel={t("fields.kind")} />
        </Field>
        <Field label={t("fields.recurrence")}>
          <ChoiceMenu value={task.recurrence as (typeof RECURRENCES)[number] | null} options={RECURRENCES} label={(r) => t(`recurrence.${r}`)} onChange={(recurrence) => set({ recurrence })} allowNone noneLabel={t("recurrence.none")} ariaLabel={t("fields.recurrence")} />
        </Field>
        {task.test_id ? (
          <Field label={t("fields.test_id")}>
            <Link href={`/scale/tests/${task.test_id}`} className="px-2 text-[13px] underline-offset-2 hover:underline">
              {index.testById.get(task.test_id)?.title ?? "—"}
            </Link>
          </Field>
        ) : null}
      </div>

      {product ? <ProductFields task={task} score={score} set={set} /> : null}

      <section className="space-y-1">
        <SectionTitle>{t("fields.description")}</SectionTitle>
        <AutoText value={task.description} onSave={(description) => set({ description })} ariaLabel={t("fields.description")} placeholder={t("panel.descriptionHint")} minRows={3} />
      </section>
      <section className="space-y-1">
        <SectionTitle>{t("fields.done_criterion")}</SectionTitle>
        <AutoText value={task.done_criterion} onSave={(done_criterion) => set({ done_criterion })} ariaLabel={t("fields.done_criterion")} placeholder={t("panel.doneHint")} minRows={1} maxLength={2000} />
      </section>

      {!task.parent_id ? <Subtasks task={task} subtasks={subtasks} /> : null}
      <Dependencies kind="task" id={task.id} />

      <section>
        <SectionTitle>{t("panel.customers")}</SectionTitle>
        <CompanyLinks entityType="task" entityId={task.id} roles={["feedback", "participant", "pilot", "other"]} />
      </section>

      <EntityExtras type="task" id={task.id} />
      {project ? (
        <p className="text-xs text-muted-foreground">
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => router.push(`/scale/projects/${project.id}`)}>
            {t("panel.openProject")}
          </button>
        </p>
      ) : null}
    </PanelFrame>
  );
}

/** The week the work is planned for: this week, next week, another one, or none. */
export function WeekPicker({ value, onChange }: { value: string | null; onChange: (monday: string | null) => void }) {
  const t = useTranslations("scale.week");
  const index = useIndex();
  const dates = useDates();
  const label = !value ? t("none") : value === index.monday ? t("this") : value === index.nextMonday ? t("next") : t("of", { date: dates.short(value) });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", !value && "text-muted-foreground")} onClick={(e) => e.stopPropagation()}>
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => onChange(index.monday)}>{t("this")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(index.nextMonday)}>{t("next")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(addDays(index.monday, 14))}>{t("inTwo")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <label className="block text-xs text-muted-foreground">
            {t("pick")}
            <input type="date" className="mt-1 block w-full rounded-md border bg-card px-2 py-1 text-sm" onChange={(e) => e.target.value && onChange(weekStart(e.target.value))} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(null)}>{t("none")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Scale5({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${label} ${n}`}
          onClick={() => onChange(value === n ? null : n)}
          className={cn("size-7 rounded-md border text-[13px] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", value === n ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function ProductFields({ task, score, set }: { task: Task; score: number | null; set: (p: Partial<Task>) => void }) {
  const t = useTranslations("scale");
  const index = useIndex();
  return (
    <section className="space-y-1 rounded-xl border bg-card/40 p-4">
      <SectionTitle>{t("product.prioritize")}</SectionTitle>
      <Field label={t("fields.why")}>
        <AutoText value={task.why} onSave={(why) => set({ why })} ariaLabel={t("fields.why")} placeholder={t("product.whyHint")} minRows={1} maxLength={2000} />
      </Field>
      <Field label={t("fields.expected_result")}>
        <AutoText value={task.expected_result} onSave={(expected_result) => set({ expected_result })} ariaLabel={t("fields.expected_result")} placeholder={t("product.expectedHint")} minRows={1} maxLength={2000} />
      </Field>
      <Field label={t("fields.impact")}>
        <Scale5 value={task.impact} onChange={(impact) => set({ impact })} label={t("fields.impact")} />
      </Field>
      <Field label={t("fields.confidence")}>
        <Scale5 value={task.confidence} onChange={(confidence) => set({ confidence })} label={t("fields.confidence")} />
      </Field>
      <Field label={t("fields.effort")}>
        <Scale5 value={task.effort} onChange={(effort) => set({ effort })} label={t("fields.effort")} />
      </Field>
      <Field label={t("fields.commercial_urgency")}>
        <ChoiceMenu value={task.commercial_urgency} options={COMMERCIAL_URGENCIES} label={(u) => t(`urgency.${u}`)} onChange={(u) => u && set({ commercial_urgency: u })} ariaLabel={t("fields.commercial_urgency")} />
      </Field>
      <Field label={t("product.score")} hint={t("product.scoreHint")}>
        <p className="px-2 py-1 text-[13px]">{score === null ? <span className="text-muted-foreground">{t("product.scoreMissing")}</span> : <span className="tabular-nums">{t("product.scoreValue", { impact: task.impact ?? 0, confidence: task.confidence ?? 0, effort: task.effort ?? 0, score })}</span>}</p>
      </Field>
      <Field label={t("fields.objective_id")}>
        <RecordMenu value={task.objective_id} items={index.objectives.map((o) => ({ id: o.id, label: o.title }))} onChange={(objective_id) => set({ objective_id })} noneLabel={t("common.none")} ariaLabel={t("fields.objective_id")} />
      </Field>
      <Field label={t("fields.test_id")}>
        <RecordMenu value={task.test_id} items={index.tests.map((x) => ({ id: x.id, label: x.title }))} onChange={(test_id) => set({ test_id })} noneLabel={t("common.none")} ariaLabel={t("fields.test_id")} />
      </Field>
    </section>
  );
}

function Subtasks({ task, subtasks }: { task: Task; subtasks: Task[] }) {
  const t = useTranslations("scale.panel");
  const actions = useScaleActions();
  const panel = usePanel();
  const [draft, setDraft] = React.useState("");
  const done = subtasks.filter((s) => s.status === "done").length;
  return (
    <section>
      <SectionTitle>{t("subtasks", { done, total: subtasks.length })}</SectionTitle>
      <ul className="space-y-0.5">
        {subtasks.map((s) => (
          <li key={s.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
            <Checkbox checked={s.status === "done"} onCheckedChange={(c) => void actions.update("task", s.id, { status: c ? "done" : "todo" })} aria-label={t("toggleSubtask", { title: s.title })} />
            <button type="button" onClick={() => panel.open("task", s.id)} className={cn("min-w-0 flex-1 truncate text-left text-sm", s.status === "done" && "text-muted-foreground line-through")}>
              {s.title}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const title = draft.trim();
          if (!title) return;
          setDraft("");
          await actions.create("task", { title, parent_id: task.id, project_id: task.project_id, milestone_id: task.milestone_id, status: "todo", sort_order: subtasks.length + 1 });
        }}
      >
        <PlusIcon className="ml-1 size-4 text-muted-foreground" />
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("addSubtask")} aria-label={t("addSubtask")} maxLength={300} className="h-8 border-transparent bg-transparent text-sm shadow-none hover:border-border" />
      </form>
    </section>
  );
}

/** What this item waits for and what waits for it. Loops are refused. */
export function Dependencies({ kind, id }: { kind: "task" | "project"; id: string }) {
  const t = useTranslations("scale.deps");
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const router = useRouter();
  const edges = kind === "task" ? index.taskEdges : index.projectEdges;
  const items = kind === "task" ? index.tasks.filter((x) => !x.parent_id) : index.projects;
  const nameOf = (x: string) => (kind === "task" ? index.taskById.get(x)?.title : index.projectById.get(x)?.title) ?? "—";
  const waitsFor = edges.filter((e) => e.from === id).map((e) => e.to);
  const blocks = edges.filter((e) => e.to === id).map((e) => e.from);
  const [query, setQuery] = React.useState("");
  const candidates = items
    .filter((x) => x.id !== id && !waitsFor.includes(x.id) && x.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .slice(0, 40)
    .map((x) => ({ id: x.id, title: x.title, loop: wouldCreateCycle(edges, id, x.id) }));
  const openItem = (x: string) => (kind === "task" ? panel.open("task", x) : router.push(`/scale/projects/${x}`));
  const status = (x: string) => {
    if (kind !== "task") return null;
    const task = index.taskById.get(x);
    return task ? <TaskStatusIcon status={task.status} /> : null;
  };

  return (
    <section>
      <SectionTitle>{t("title")}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("waitsFor")}</p>
          {waitsFor.length === 0 ? <p className="text-sm text-muted-foreground">{t("nothing")}</p> : null}
          <ul className="space-y-0.5">
            {waitsFor.map((x) => (
              <li key={x} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
                {status(x) ?? <GitBranchIcon className="size-4 text-muted-foreground" />}
                <button type="button" onClick={() => openItem(x)} className="min-w-0 flex-1 truncate text-left text-sm">
                  {nameOf(x)}
                </button>
                <button type="button" aria-label={t("remove", { name: nameOf(x) })} onClick={() => void actions.setDependency(kind, id, x, false)} className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100">
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <DropdownMenu onOpenChange={(o) => !o && setQuery("")}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="-ml-2 mt-1">
                <PlusIcon />
                {t("add")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <div className="p-1">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={t("search")} aria-label={t("search")} className="h-8 text-[13px]" autoFocus />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {candidates.map((c) => (
                  <DropdownMenuItem key={c.id} disabled={c.loop} onSelect={() => void actions.setDependency(kind, id, c.id, true)}>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.loop ? <span className="text-[11px] text-muted-foreground">{t("loop")}</span> : null}
                  </DropdownMenuItem>
                ))}
                {candidates.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t("noCandidate")}</p> : null}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("blocks")}</p>
          {blocks.length === 0 ? <p className="text-sm text-muted-foreground">{t("nothing")}</p> : null}
          <ul className="space-y-0.5">
            {blocks.map((x) => (
              <li key={x} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
                {status(x) ?? <GitBranchIcon className="size-4 text-muted-foreground" />}
                <button type="button" onClick={() => openItem(x)} className="min-w-0 flex-1 truncate text-left text-sm">
                  {nameOf(x)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ─── Objective ──────────────────────────────────────────────────────────────

function ObjectivePanel({ id }: { id: string }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const data = useScale();
  const actions = useScaleActions();
  const dates = useDates();
  const o = data.objectives.find((x) => x.id === id);
  if (!o) return <Missing />;
  const set = (patch: Partial<Objective>) => void actions.update("objective", o.id, patch);
  const projects = index.projectsByObjective.get(o.id) ?? [];
  const attainment = objectiveAttainment(o);
  const work = taskProgress(projects.flatMap((p) => index.tasksByProject.get(p.id) ?? []));

  return (
    <PanelFrame entity="objective" id={o.id} archived={Boolean(o.archived_at)} crumbs={t("panel.kinds.objective")}>
      <InlineText value={o.title} onSave={(title) => set({ title })} required ariaLabel={t("fields.title")} className="text-xl font-semibold tracking-tight" />
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card/40 px-4 py-3">
        <div>
          <p className="text-sm font-medium">{t("objective.focus")}</p>
          <p className="text-xs text-muted-foreground">{t("objective.focusHint")}</p>
        </div>
        <Switch checked={o.is_focus} onCheckedChange={(is_focus) => set({ is_focus })} aria-label={t("objective.focus")} />
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("objective.result")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {o.kind === "validation" ? t(`validation.${o.validation_state}`) : attainment === null ? t("common.notFilled") : dates.percent(attainment)}
          </p>
          {o.kind === "numeric" ? <ProgressBar ratio={attainment} label={t("objective.result")} tone="success" className="mt-2" /> : null}
          <p className="mt-2 text-xs text-muted-foreground">{t("objective.resultHint")}</p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("objective.work")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{work.total ? `${work.done}/${work.total}` : "—"}</p>
          <ProgressBar ratio={work.ratio} label={t("objective.work")} className="mt-2" />
          <p className="mt-2 text-xs text-muted-foreground">{t("objective.workHint")}</p>
        </div>
      </section>

      <div className="space-y-0.5">
        <Field label={t("fields.kind")}>
          <ChoiceMenu value={o.kind as (typeof OBJECTIVE_KINDS)[number]} options={OBJECTIVE_KINDS} label={(k) => t(`objective.kinds.${k}`)} onChange={(kind) => kind && set({ kind })} ariaLabel={t("fields.kind")} />
        </Field>
        <Field label={t("fields.metric")}>
          <InlineText value={o.metric ?? ""} onSave={(metric) => set({ metric: metric || null })} ariaLabel={t("fields.metric")} placeholder={t("objective.metricHint")} className="h-7 text-[13px]" />
        </Field>
        {o.kind === "numeric" ? (
          <>
            <Field label={t("objective.values")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <label className="flex items-center gap-1 text-muted-foreground">
                  {t("fields.baseline")}
                  <NumberField value={o.baseline} onSave={(baseline) => set({ baseline })} ariaLabel={t("fields.baseline")} placeholder="—" />
                </label>
                <label className="flex items-center gap-1 text-muted-foreground">
                  {t("fields.current_value")}
                  <NumberField value={o.current_value} onSave={(current_value) => set({ current_value })} ariaLabel={t("fields.current_value")} placeholder="—" />
                </label>
                <label className="flex items-center gap-1 text-muted-foreground">
                  {t("fields.target")}
                  <NumberField value={o.target} onSave={(target) => set({ target })} ariaLabel={t("fields.target")} placeholder="—" />
                </label>
              </div>
            </Field>
            <Field label={t("fields.unit")}>
              <InlineText value={o.unit ?? ""} onSave={(unit) => set({ unit: unit || null })} ariaLabel={t("fields.unit")} placeholder={t("objective.unitHint")} maxLength={30} className="h-7 w-40 text-[13px]" />
            </Field>
            <Field label={t("fields.metric_source")}>
              <InlineText value={o.metric_source ?? ""} onSave={(metric_source) => set({ metric_source: metric_source || null })} ariaLabel={t("fields.metric_source")} placeholder={t("objective.sourceHint")} maxLength={200} className="h-7 text-[13px]" />
            </Field>
            <Field label={t("objective.updated")}>
              <p className="px-2 py-1 text-[13px] text-muted-foreground">{o.metric_updated_at ? dates.relative(o.metric_updated_at) : t("common.never")}</p>
            </Field>
          </>
        ) : (
          <Field label={t("fields.validation_state")} hint={t("objective.validationHint")}>
            <ChoiceMenu value={o.validation_state as (typeof VALIDATION_STATES)[number]} options={VALIDATION_STATES} label={(v) => t(`validation.${v}`)} onChange={(v) => v && set({ validation_state: v })} ariaLabel={t("fields.validation_state")} />
          </Field>
        )}
        <Field label={t("fields.status")}>
          <ChoiceMenu value={o.status as (typeof OBJECTIVE_STATUSES)[number]} options={OBJECTIVE_STATUSES} label={(s) => t(`objectiveStatus.${s}`)} onChange={(s) => s && set({ status: s })} ariaLabel={t("fields.status")} />
        </Field>
        <Field label={t("fields.due_date")}>
          <DateField value={o.due_date} onChange={(due_date) => set({ due_date })} label={t("fields.due_date")} placeholder={t("common.optional")} />
        </Field>
        <Field label={t("fields.owner_id")}>
          <PersonMenu value={o.owner_id} team={data.team} onChange={(owner_id) => set({ owner_id })} />
        </Field>
      </div>
      <section className="space-y-1">
        <SectionTitle>{t("fields.description")}</SectionTitle>
        <AutoText value={o.description} onSave={(description) => set({ description })} ariaLabel={t("fields.description")} placeholder={t("objective.descriptionHint")} maxLength={5000} />
      </section>
      <section>
        <SectionTitle>{t("objective.projects")}</SectionTitle>
        <ul className="space-y-1">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Link href={`/scale/projects/${p.id}`} className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline">
                {p.title}
              </Link>
              <button type="button" aria-label={t("objective.unlinkProject", { name: p.title })} onClick={() => void actions.update("project", p.id, { objective_id: null })} className="rounded p-1 text-muted-foreground hover:bg-accent">
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <RecordMenu
          value={null}
          items={index.projects.filter((p) => p.objective_id !== o.id).map((p) => ({ id: p.id, label: p.title }))}
          onChange={(pid) => pid && void actions.update("project", pid, { objective_id: o.id })}
          noneLabel={t("objective.linkProject")}
          ariaLabel={t("objective.linkProject")}
          icon={<PlusIcon className="size-4" />}
          className="-ml-2 mt-1"
        />
      </section>
      <EntityExtras type="objective" id={o.id} />
    </PanelFrame>
  );
}

// ─── Milestone ──────────────────────────────────────────────────────────────

function MilestonePanel({ id }: { id: string }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const data = useScale();
  const actions = useScaleActions();
  const panel = usePanel();
  const m = data.milestones.find((x) => x.id === id);
  if (!m) return <Missing />;
  const set = (patch: Partial<Milestone>) => void actions.update("milestone", m.id, patch);
  const project = index.projectById.get(m.project_id);
  const tasks = index.tasks.filter((x) => x.milestone_id === m.id && !x.parent_id);
  const progress = taskProgress(tasks);
  const late = !m.achieved_date && m.target_date && m.target_date < index.today;
  return (
    <PanelFrame
      entity="milestone"
      id={m.id}
      archived={Boolean(m.archived_at)}
      crumbs={
        project ? (
          <Link href={`/scale/projects/${project.id}`} className="hover:text-foreground">
            {project.title}
          </Link>
        ) : (
          t("panel.kinds.milestone")
        )
      }
    >
      <div className="flex items-start gap-2">
        <FlagIcon className={cn("mt-2 size-5 shrink-0", m.achieved_date ? "text-success" : late ? "text-destructive" : "text-muted-foreground")} />
        <InlineText value={m.title} onSave={(title) => set({ title })} required ariaLabel={t("fields.title")} className="text-xl font-semibold tracking-tight" />
      </div>
      <div className="space-y-0.5">
        <Field label={t("fields.target_date")}>
          <DateField value={m.target_date} onChange={(target_date) => set({ target_date })} label={t("fields.target_date")} tone={late ? "overdue" : null} />
        </Field>
        <Field label={t("fields.achieved_date")} hint={t("milestone.achievedHint")}>
          {m.achieved_date ? (
            <DateField value={m.achieved_date} onChange={(achieved_date) => set({ achieved_date })} label={t("fields.achieved_date")} />
          ) : (
            <Button size="sm" variant="outline" onClick={() => set({ achieved_date: index.today })}>
              <CheckIcon />
              {t("milestone.markReached")}
            </Button>
          )}
        </Field>
        <Field label={t("milestone.tasks")}>
          <div className="space-y-1.5 px-2 py-1">
            <p className="text-[13px] tabular-nums">{progress.total ? t("common.doneOf", { done: progress.done, total: progress.total }) : t("milestone.noTasks")}</p>
            <ProgressBar ratio={progress.ratio} label={t("milestone.tasks")} />
          </div>
        </Field>
      </div>
      <section className="space-y-1">
        <SectionTitle>{t("fields.description")}</SectionTitle>
        <AutoText value={m.description} onSave={(description) => set({ description })} ariaLabel={t("fields.description")} maxLength={5000} />
      </section>
      <section>
        <SectionTitle>{t("milestone.tasks")}</SectionTitle>
        <ul className="space-y-0.5">
          {tasks.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => panel.open("task", x.id)} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-accent/50">
                <TaskStatusIcon status={x.status} />
                <span className={cn("min-w-0 flex-1 truncate", x.status === "done" && "text-muted-foreground line-through")}>{x.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <AddTaskInline projectId={m.project_id} milestoneId={m.id} />
      </section>
      <EntityExtras type="milestone" id={m.id} />
    </PanelFrame>
  );
}

export function AddTaskInline({ projectId, milestoneId, placeholder, extra }: { projectId: string | null; milestoneId?: string | null; placeholder?: string; extra?: Record<string, unknown> }) {
  const t = useTranslations("scale.panel");
  const actions = useScaleActions();
  const [draft, setDraft] = React.useState("");
  return (
    <form
      className="mt-1 flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const title = draft.trim();
        if (!title) return;
        setDraft("");
        await actions.create("task", { title, status: "todo", ...(projectId ? { project_id: projectId } : {}), ...(milestoneId ? { milestone_id: milestoneId } : {}), ...extra });
      }}
    >
      <PlusIcon className="ml-1 size-4 shrink-0 text-muted-foreground" />
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder ?? t("addTask")} aria-label={placeholder ?? t("addTask")} maxLength={300} className="h-8 border-transparent bg-transparent text-sm shadow-none hover:border-border" />
    </form>
  );
}

// ─── Decision ───────────────────────────────────────────────────────────────

export function DecisionFields({ d }: { d: Decision }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const data = useScale();
  const actions = useScaleActions();
  const set = (patch: Partial<Decision>) => void actions.update("decision", d.id, patch);
  return (
    <>
      <div className="space-y-0.5">
        <Field label={t("fields.status")}>
          <ChoiceMenu value={d.status as (typeof DECISION_STATUSES)[number]} options={DECISION_STATUSES} label={(s) => t(`decisionStatus.${s}`)} onChange={(s) => s && set({ status: s, ...(s === "decided" && !d.decided_on ? { decided_on: index.today } : {}) })} ariaLabel={t("fields.status")} />
        </Field>
        <Field label={t("fields.decided_on")}>
          <DateField value={d.decided_on} onChange={(decided_on) => set({ decided_on })} label={t("fields.decided_on")} />
        </Field>
        <Field label={t("fields.review_on")} hint={t("decision.reviewHint")}>
          <DateField value={d.review_on} onChange={(review_on) => set({ review_on })} label={t("fields.review_on")} placeholder={t("common.optional")} tone={d.review_on && d.review_on <= index.today ? "soon" : null} />
        </Field>
        <Field label={t("fields.owner_id")}>
          <PersonMenu value={d.owner_id} team={data.team} onChange={(owner_id) => set({ owner_id })} />
        </Field>
        <Field label={t("fields.project_id")}>
          <RecordMenu value={d.project_id} items={index.projects.map((p) => ({ id: p.id, label: p.title }))} onChange={(project_id) => set({ project_id })} noneLabel={t("common.none")} ariaLabel={t("fields.project_id")} />
        </Field>
        <Field label={t("fields.test_id")}>
          <RecordMenu value={d.test_id} items={index.tests.map((x) => ({ id: x.id, label: x.title }))} onChange={(test_id) => set({ test_id })} noneLabel={t("common.none")} ariaLabel={t("fields.test_id")} />
        </Field>
        <Field label={t("fields.document_id")}>
          <RecordMenu value={d.document_id} items={data.documents.filter((x) => !x.archived_at).map((x) => ({ id: x.id, label: x.title }))} onChange={(document_id) => set({ document_id })} noneLabel={t("common.none")} ariaLabel={t("fields.document_id")} />
        </Field>
      </div>
      {(["options", "choice", "reasons", "evidence", "review_condition"] as const).map((f) => (
        <section key={f} className="space-y-1">
          <SectionTitle>{t(`fields.${f}`)}</SectionTitle>
          <AutoText value={d[f]} onSave={(v) => set({ [f]: v })} ariaLabel={t(`fields.${f}`)} placeholder={t(`decision.hints.${f}`)} minRows={f === "choice" || f === "review_condition" ? 1 : 2} maxLength={f === "choice" ? 2000 : f === "review_condition" ? 1000 : 5000} />
        </section>
      ))}
    </>
  );
}

function DecisionPanel({ id }: { id: string }) {
  const t = useTranslations("scale");
  const data = useScale();
  const actions = useScaleActions();
  const d = data.decisions.find((x) => x.id === id);
  if (!d) return <Missing />;
  return (
    <PanelFrame entity="decision" id={d.id} archived={Boolean(d.archived_at)} crumbs={t("panel.kinds.decision")}>
      <InlineText value={d.subject} onSave={(subject) => void actions.update("decision", d.id, { subject })} required ariaLabel={t("fields.subject")} className="text-xl font-semibold tracking-tight" maxLength={300} />
      <DecisionFields d={d} />
      <section>
        <SectionTitle>{t("panel.customers")}</SectionTitle>
        <CompanyLinks entityType="decision" entityId={d.id} />
      </section>
      <EntityExtras type="decision" id={d.id} />
    </PanelFrame>
  );
}

// ─── Customer company: what Scale holds about it (ids only, never its content) ───

function CompanyPanel({ id }: { id: string }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const data = useScale();
  const panel = usePanel();
  const company = index.companyById.get(id);
  const links = index.linksByCompany.get(id) ?? [];
  if (!company) return <Missing />;
  const label = (type: string, entityId: string) => {
    if (type === "project") return index.projectById.get(entityId)?.title;
    if (type === "task") return index.taskById.get(entityId)?.title;
    if (type === "test") return index.testById.get(entityId)?.title;
    return data.decisions.find((d) => d.id === entityId)?.subject;
  };
  return (
    <PanelFrame id={id} crumbs={t("panel.kinds.company")}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <BuildingIcon className="size-5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">{company.name}</h2>
          <p className="text-sm text-muted-foreground">
            {company.planName ?? "—"} · {t(`companies.status.${company.status === "active" ? "active" : company.status === "suspended" ? "suspended" : "other"}`)}
          </p>
        </div>
      </div>
      <CompanyConsoleLink id={company.id} />
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t("companies.privacy")}</p>
      <section>
        <SectionTitle>{t("companies.inScale", { count: links.length })}</SectionTitle>
        {links.length === 0 ? <p className="text-sm text-muted-foreground">{t("companies.noneInScale")}</p> : null}
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t(`search.types.${l.entity_type}`)}</span>
                {l.entity_type === "task" || l.entity_type === "decision" ? (
                  <button type="button" onClick={() => panel.open(l.entity_type as "task" | "decision", l.entity_id)} className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline">
                    {label(l.entity_type, l.entity_id) ?? "—"}
                  </button>
                ) : (
                  <Link href={l.entity_type === "project" ? `/scale/projects/${l.entity_id}` : `/scale/tests/${l.entity_id}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                    {label(l.entity_type, l.entity_id) ?? "—"}
                  </Link>
                )}
                <span className="text-xs text-muted-foreground">{t(`companies.roles.${l.role}`)}</span>
              </div>
              {l.note ? <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground/90">{l.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </PanelFrame>
  );
}
