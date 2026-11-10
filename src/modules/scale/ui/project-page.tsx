"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArchiveIcon, ArchiveRestoreIcon, BookOpenTextIcon, CheckIcon, ChevronLeftIcon, CopyIcon, EllipsisIcon, FlagIcon, FlaskConicalIcon, PlusIcon, ScaleIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { healthHints, isClosedTask, taskProgress } from "../logic/planning";
import { TEST_TEMPLATES } from "../templates";
import { AXES, HORIZONS, PROJECT_STATUSES, type Project } from "../types";
import { CompanyLinks, EntityExtras } from "./details";
import { AddTaskInline, Dependencies } from "./panel";
import { AutoText, ChoiceMenu, DateField, Field, HealthMenu, InlineText, PersonMenu, PriorityMenu, ProgressBar, RecordMenu, SectionTitle, useDates } from "./primitives";
import { useReschedule } from "./reschedule";
import { dueTone, useIndex } from "./selectors";
import { usePanel, useScale, useScaleActions } from "./store";
import { TaskRow } from "./task-row";

/** A project's page: expected result, criterion, milestones, tasks, tests, decisions, documents. */
export function ProjectPage({ id }: { id: string }) {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const router = useRouter();
  const dates = useDates();
  const reschedule = useReschedule();
  const p = data.projects.find((x) => x.id === id);
  if (!p) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-muted-foreground">{t("project.missing")}</p>
        <Button asChild size="sm" variant="outline" className="mt-4">
          <Link href="/scale/projects">{t("project.back")}</Link>
        </Button>
      </div>
    );
  }
  const set = (patch: Partial<Project>) => void actions.update("project", p.id, patch);
  const tasks = index.tasksByProject.get(p.id) ?? [];
  const progress = taskProgress(tasks);
  const milestones = (index.milestonesByProject.get(p.id) ?? []).slice().sort((a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"));
  const hints = healthHints(p, milestones, tasks, index.today);
  const lastUpdate = [p.updated_at, ...tasks.map((x) => x.updated_at), ...milestones.map((m) => m.updated_at)].sort().pop()!;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href="/scale/projects" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" />
          {t("project.back")}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={t("panel.more")}>
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={async () => {
                const newId = await actions.duplicate("project", p.id);
                if (newId) router.push(`/scale/projects/${newId}`);
              }}
            >
              <CopyIcon />
              {t("panel.duplicate")}
            </DropdownMenuItem>
            {p.archived_at ? (
              <>
                <DropdownMenuItem onSelect={() => void actions.archive("project", p.id, false)}>
                  <ArchiveRestoreIcon />
                  {t("panel.restore")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={async () => {
                    if (window.confirm(t("panel.deleteConfirm")) && (await actions.remove("project", p.id))) router.push("/scale/projects");
                  }}
                >
                  <Trash2Icon />
                  {t("panel.delete")}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={() => void actions.archive("project", p.id, true)}>
                <ArchiveIcon />
                {t("panel.archive")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {p.archived_at ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <ArchiveIcon className="size-4" />
          <span className="flex-1">{t("panel.archivedNotice")}</span>
          <Button size="sm" variant="outline" onClick={() => void actions.archive("project", p.id, false)}>
            {t("panel.restore")}
          </Button>
        </div>
      ) : null}

      <InlineText value={p.title} onSave={(title) => set({ title })} required maxLength={200} ariaLabel={t("fields.title")} className="-ml-1 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]" />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ChoiceMenu value={p.status} options={PROJECT_STATUSES} label={(s) => t(`projectStatus.${s}`)} onChange={(status) => status && set({ status, ...(status === "done" && !p.achieved_date ? { achieved_date: index.today } : {}) })} ariaLabel={t("fields.status")} className="border" />
        <HealthMenu value={p.health} onChange={(health) => set({ health })} />
        <PriorityMenu value={p.priority} onChange={(priority) => set({ priority })} />
        <ChoiceMenu value={p.axis as (typeof AXES)[number] | null} options={AXES} label={(a) => t(`axis.${a}`)} onChange={(axis) => set({ axis })} allowNone noneLabel={t("axis.none")} ariaLabel={t("fields.axis")} />
        <ChoiceMenu value={p.horizon as (typeof HORIZONS)[number] | null} options={HORIZONS} label={(h) => t(`horizon.${h}`)} onChange={(horizon) => set({ horizon })} allowNone noneLabel={t("horizon.none")} ariaLabel={t("fields.horizon")} />
        <PersonMenu value={p.owner_id} team={data.team} onChange={(owner_id) => set({ owner_id })} />
        <span className="ml-auto text-xs text-muted-foreground">{t("project.updated", { when: dates.relative(lastUpdate) })}</span>
      </div>
      {hints.length ? (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          {t("project.hints", { list: hints.map((h) => t(`project.hint.${h}`)).join(" · ") })}
        </p>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("fields.outcome")}</p>
              <AutoText value={p.outcome} onSave={(outcome) => set({ outcome })} ariaLabel={t("fields.outcome")} placeholder={t("project.outcomeHint")} maxLength={2000} minRows={2} className="-mx-2 mt-1" />
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("fields.success_criterion")}</p>
              <AutoText value={p.success_criterion} onSave={(success_criterion) => set({ success_criterion })} ariaLabel={t("fields.success_criterion")} placeholder={t("project.criterionHint")} maxLength={2000} minRows={2} className="-mx-2 mt-1" />
              <p className="mt-1 text-[11px] text-muted-foreground">{t("project.criterionNote")}</p>
            </div>
          </section>

          <Milestones project={p} milestones={milestones} />
          <ProjectTasks project={p} />

          <section className="space-y-1">
            <SectionTitle>{t("fields.description")}</SectionTitle>
            <AutoText value={p.description} onSave={(description) => set({ description })} ariaLabel={t("fields.description")} placeholder={t("project.descriptionHint")} minRows={3} />
          </section>

          <Linked project={p} />
        </div>

        <aside className="space-y-6">
          <div className="rounded-2xl border p-4">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{t("project.taskProgress")}</span>
              <span className="tabular-nums">{progress.total ? `${progress.done}/${progress.total}` : "—"}</span>
            </div>
            <ProgressBar ratio={progress.ratio} label={t("project.taskProgress")} />
            <p className="mt-2 text-[11px] text-muted-foreground">{t("project.progressNote")}</p>
          </div>
          <div className="space-y-0.5">
            <Field label={t("fields.next_action")}>
              <InlineText value={p.next_action ?? ""} onSave={(next_action) => set({ next_action: next_action || null })} ariaLabel={t("fields.next_action")} placeholder={t("project.nextActionHint")} maxLength={300} className="h-7 text-[13px]" />
            </Field>
            <Field label={t("fields.objective_id")}>
              <RecordMenu value={p.objective_id} items={index.objectives.map((o) => ({ id: o.id, label: o.title }))} onChange={(objective_id) => set({ objective_id })} noneLabel={t("common.none")} ariaLabel={t("fields.objective_id")} />
            </Field>
            <Field label={t("fields.start_date")}>
              <DateField value={p.start_date} onChange={(start) => reschedule("project", p.id, { start, end: p.target_date })} label={t("fields.start_date")} />
            </Field>
            <Field label={t("fields.target_date")}>
              <DateField value={p.target_date} onChange={(end) => reschedule("project", p.id, { start: p.start_date, end })} label={t("fields.target_date")} min={p.start_date} tone={dueTone(p.target_date, index.today, p.status === "done" || p.status === "cancelled")} />
            </Field>
            <Field label={t("fields.achieved_date")} hint={t("project.achievedHint")}>
              <DateField value={p.achieved_date} onChange={(achieved_date) => set({ achieved_date })} label={t("fields.achieved_date")} placeholder={t("project.notReached")} />
            </Field>
          </div>
          <Dependencies kind="project" id={p.id} />
          <section>
            <SectionTitle>{t("panel.customers")}</SectionTitle>
            <CompanyLinks entityType="project" entityId={p.id} roles={["pilot", "participant", "feedback", "other"]} />
          </section>
          <EntityExtras type="project" id={p.id} />
        </aside>
      </div>
    </div>
  );
}

function Milestones({ project, milestones }: { project: Project; milestones: ReturnType<typeof useIndex>["milestones"] }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const dates = useDates();
  const [title, setTitle] = React.useState("");
  const [date, setDate] = React.useState("");
  return (
    <section>
      <SectionTitle>{t("project.milestones", { count: milestones.length })}</SectionTitle>
      {milestones.length === 0 ? <p className="mb-2 text-sm text-muted-foreground">{t("project.noMilestones")}</p> : null}
      <ol className="relative space-y-1">
        {milestones.map((m) => {
          const late = !m.achieved_date && m.target_date && m.target_date < index.today;
          const tasks = index.tasks.filter((x) => x.milestone_id === m.id && !x.parent_id);
          const progress = taskProgress(tasks);
          return (
            <li key={m.id} className="group flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/50">
              <FlagIcon className={cn("size-4 shrink-0", m.achieved_date ? "text-success" : late ? "text-destructive" : "text-muted-foreground")} aria-label={m.achieved_date ? t("milestone.reached") : late ? t("milestone.late") : t("milestone.upcoming")} />
              <button type="button" onClick={() => panel.open("milestone", m.id)} className={cn("min-w-0 flex-1 truncate text-left text-sm", m.achieved_date && "text-muted-foreground")}>
                {m.title}
              </button>
              {progress.total ? <span className="text-xs tabular-nums text-muted-foreground">{progress.done}/{progress.total}</span> : null}
              <DateField value={m.target_date} onChange={(target_date) => void actions.update("milestone", m.id, { target_date })} label={t("fields.target_date")} placeholder={t("fields.target_date")} tone={late ? "overdue" : null} />
              {m.achieved_date ? (
                <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">{t("milestone.reachedOn", { date: dates.short(m.achieved_date) })}</span>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 text-xs opacity-70 group-hover:opacity-100" onClick={() => void actions.update("milestone", m.id, { achieved_date: index.today })}>
                  <CheckIcon />
                  {t("milestone.markReached")}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      <form
        className="mt-1 flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const row = await actions.create("milestone", { project_id: project.id, title: title.trim(), ...(date ? { target_date: date } : {}) });
          if (row) {
            setTitle("");
            setDate("");
          }
        }}
      >
        <PlusIcon className="ml-2 size-4 text-muted-foreground" />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("project.addMilestone")} aria-label={t("project.addMilestone")} maxLength={200} className="h-8 max-w-xs border-transparent bg-transparent shadow-none hover:border-border" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("fields.target_date")} className="h-8 w-40 text-[13px]" />
        {title.trim() ? (
          <Button type="submit" size="sm" className="h-8">
            {t("common.add")}
          </Button>
        ) : null}
      </form>
    </section>
  );
}

function ProjectTasks({ project }: { project: Project }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const [showClosed, setShowClosed] = React.useState(false);
  const tasks = (index.tasksByProject.get(project.id) ?? []).filter((x) => !x.parent_id && (showClosed || !isClosedTask(x))).sort((a, b) => a.sort_order - b.sort_order);
  const milestones = index.milestonesByProject.get(project.id) ?? [];
  const groups = [
    ...milestones.map((m) => ({ key: m.id, label: m.title, milestoneId: m.id as string | null, items: tasks.filter((x) => x.milestone_id === m.id) })),
    { key: "none", label: t("project.noMilestoneGroup"), milestoneId: null, items: tasks.filter((x) => !x.milestone_id || !milestones.some((m) => m.id === x.milestone_id)) },
  ];
  const closed = (index.tasksByProject.get(project.id) ?? []).filter((x) => !x.parent_id && isClosedTask(x)).length;
  return (
    <section>
      <SectionTitle
        action={
          closed ? (
            <button type="button" onClick={() => setShowClosed(!showClosed)} className="text-xs text-muted-foreground hover:text-foreground">
              {showClosed ? t("project.hideClosed") : t("project.showClosed", { count: closed })}
            </button>
          ) : null
        }
      >
        {t("project.tasks")}
      </SectionTitle>
      <div className="space-y-4">
        {groups
          .filter((g) => g.items.length || g.key === "none" || milestones.length <= 3)
          .map((g) => (
            <div key={g.key}>
              {milestones.length ? (
                <p className="mb-0.5 flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
                  {g.milestoneId ? <FlagIcon className="size-3.5" /> : null}
                  {g.label}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {g.items.map((x) => (
                  <TaskRow key={x.id} task={x} showProject={false} />
                ))}
              </div>
              <AddTaskInline projectId={project.id} milestoneId={g.milestoneId} />
            </div>
          ))}
      </div>
    </section>
  );
}

function Linked({ project }: { project: Project }) {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const router = useRouter();
  const tests = index.testsByProject.get(project.id) ?? [];
  const decisions = data.decisions.filter((d) => d.project_id === project.id && !d.archived_at);
  const docs = data.documents.filter((d) => d.project_id === project.id && !d.archived_at);
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section>
        <SectionTitle>{t("project.tests")}</SectionTitle>
        <ul className="space-y-1">
          {tests.map((x) => (
            <li key={x.id}>
              <Link href={`/scale/tests/${x.id}`} className="flex items-center gap-2 text-sm hover:underline">
                <FlaskConicalIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{x.title}</span>
              </Link>
              <p className="ml-6 text-xs text-muted-foreground">
                {t(`testStatus.${x.status}`)}
                {x.conclusion ? ` · ${t(`conclusion.${x.conclusion}`)}` : ""}
              </p>
            </li>
          ))}
        </ul>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="-ml-2 mt-1">
              <PlusIcon />
              {t("project.addTest")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("tests.fromTemplate")}</DropdownMenuLabel>
            {TEST_TEMPLATES.map((k) => (
              <DropdownMenuItem
                key={k}
                onSelect={async () => {
                  const row = await actions.createTestFromTemplate(k, project.id);
                  if (row) router.push(`/scale/tests/${row.id}`);
                }}
              >
                {t(`tests.templates.${k}`)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                const row = await actions.create("test", { title: t("tests.untitled"), project_id: project.id });
                if (row) router.push(`/scale/tests/${row.id}`);
              }}
            >
              {t("tests.blank")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
      <section>
        <SectionTitle>{t("project.decisions")}</SectionTitle>
        <ul className="space-y-1">
          {decisions.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => panel.open("decision", d.id)} className="flex items-center gap-2 text-left text-sm hover:underline">
                <ScaleIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{d.subject}</span>
              </button>
              <p className="ml-6 text-xs text-muted-foreground">{t(`decisionStatus.${d.status}`)}</p>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 mt-1"
          onClick={async () => {
            const row = await actions.create("decision", { subject: t("decision.untitled"), project_id: project.id });
            if (row) panel.open("decision", row.id);
          }}
        >
          <PlusIcon />
          {t("project.addDecision")}
        </Button>
      </section>
      <section>
        <SectionTitle>{t("project.documents")}</SectionTitle>
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={`/scale/strategy/${d.id}`} className="flex items-center gap-2 text-sm hover:underline">
                <BookOpenTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{d.title}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 mt-1"
          onClick={async () => {
            const row = await actions.create("document", { title: t("strategy.untitled"), template_key: "blank", project_id: project.id });
            if (row) router.push(`/scale/strategy/${row.id}`);
          }}
        >
          <PlusIcon />
          {t("project.addDocument")}
        </Button>
      </section>
    </div>
  );
}
