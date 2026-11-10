"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BugIcon, FolderKanbanIcon, HammerIcon, LayoutGridIcon, ListTodoIcon, MessageCircleIcon, PackageIcon, PlusIcon, SparklesIcon, WrenchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isClosedTask, priorityScore } from "../logic/planning";
import { AXES, HEALTHS, PRODUCT_KINDS, PROJECT_STATUSES, type Axis, type Health, type ProjectStatus, type Task } from "../types";
import { ProjectCard } from "./overview";
import { ChoiceMenu, PriorityMenu, ScalePageHeader, Segmented, TaskStatusMenu } from "./primitives";
import { useIndex } from "./selectors";
import { usePanel, usePref, useScaleActions } from "./store";
import { TASK_VIEWS, TaskViews, type TaskView } from "./task-views";

type Tab = "projects" | "tasks" | "product";

export function ProjectsPage() {
  const t = useTranslations("scale.projects");
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = usePref<Tab>("projects-tab", "projects");
  const [view, setView] = usePref<TaskView>("tasks-view", "list");

  // A link such as /scale/projects?view=unplanned opens that task view.
  React.useEffect(() => {
    const v = params.get("view");
    if (v && (TASK_VIEWS as readonly string[]).includes(v)) {
      setTab("tasks");
      setView(v as TaskView);
      const next = new URLSearchParams(params.toString());
      next.delete("view");
      router.replace(next.toString() ? `/scale/projects?${next}` : "/scale/projects", { scroll: false });
    }
  }, [params, router, setTab, setView]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <ScalePageHeader title={t("title")} description={t("description")} />
      <Segmented
        value={tab}
        onChange={setTab}
        label={t("tabs.label")}
        className="mb-6"
        options={[
          { value: "projects", label: t("tabs.projects"), icon: <FolderKanbanIcon /> },
          { value: "tasks", label: t("tabs.tasks"), icon: <ListTodoIcon /> },
          { value: "product", label: t("tabs.product"), icon: <PackageIcon /> },
        ]}
      />
      {tab === "projects" ? <ProjectsGrid /> : tab === "tasks" ? <TaskViews view={view} onView={setView} /> : <ProductView />}
    </div>
  );
}

// ─── Projects ───────────────────────────────────────────────────────────────

type ProjectFilters = { statuses: ProjectStatus[]; axis: Axis | null; health: Health | null; group: "axis" | "status" | "none" };

function ProjectsGrid() {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const router = useRouter();
  const [f, setF] = usePref<ProjectFilters>("projects-filters", { statuses: ["planned", "active", "paused"], axis: null, health: null, group: "axis" });
  const [draft, setDraft] = React.useState("");
  const list = index.projects.filter((p) => (!f.statuses.length || f.statuses.includes(p.status)) && (!f.axis || p.axis === f.axis) && (!f.health || p.health === f.health));
  const groups =
    f.group === "axis"
      ? [...AXES.map((a) => ({ key: a as string, label: t(`axis.${a}`), items: list.filter((p) => p.axis === a) })), { key: "none", label: t("axis.none"), items: list.filter((p) => !p.axis) }]
      : f.group === "status"
        ? PROJECT_STATUSES.map((s) => ({ key: s as string, label: t(`projectStatus.${s}`), items: list.filter((p) => p.status === s) }))
        : [{ key: "all", label: "", items: list }];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-[16rem] flex-1 items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const title = draft.trim();
            if (!title) return;
            const row = await actions.create("project", { title, status: "planned" });
            if (row) {
              setDraft("");
              router.push(`/scale/projects/${row.id}`);
            }
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("projects.newPlaceholder")} aria-label={t("projects.new")} maxLength={200} className="h-9 max-w-sm" />
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            <PlusIcon />
            {t("projects.new")}
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-1">
          {PROJECT_STATUSES.map((s) => {
            const on = f.statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => setF({ ...f, statuses: on ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] })}
                className={cn("h-7 rounded-full border px-2.5 text-xs transition-colors", on ? "border-foreground/40 bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60")}
              >
                {t(`projectStatus.${s}`)}
              </button>
            );
          })}
          <ChoiceMenu value={f.axis} options={AXES} label={(a) => t(`axis.${a}`)} onChange={(axis) => setF({ ...f, axis })} allowNone noneLabel={t("projects.allAxes")} ariaLabel={t("fields.axis")} className="h-7 border text-xs" />
          <ChoiceMenu value={f.health} options={HEALTHS} label={(h) => t(`health.${h}`)} onChange={(health) => setF({ ...f, health })} allowNone noneLabel={t("projects.allHealth")} ariaLabel={t("fields.health")} className="h-7 border text-xs" />
          <ChoiceMenu value={f.group} options={["axis", "status", "none"] as const} label={(g) => t(`projects.groupBy.${g}`)} onChange={(group) => group && setF({ ...f, group })} ariaLabel={t("projects.group")} className="h-7 border text-xs" />
        </div>
      </div>
      {index.projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-14 text-center">
          <LayoutGridIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-medium">{t("projects.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("projects.emptyText")}</p>
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("projects.noMatch")}</p>
      ) : null}
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.key} aria-label={g.label || t("projects.title")}>
            {g.label ? (
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.label} <span className="tabular-nums">{g.items.length}</span>
              </h2>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

// ─── Product: features, bugs, customer feedback, improvements, debt ─────────

const KIND_ICON = { feature: SparklesIcon, bug: BugIcon, feedback: MessageCircleIcon, improvement: WrenchIcon, debt: HammerIcon } as const;

function ProductView() {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const [kind, setKind] = usePref<"all" | (typeof PRODUCT_KINDS)[number]>("product-kind", "all");
  const [sort, setSort] = usePref<"score" | "priority" | "recent">("product-sort", "score");
  const [showClosed, setShowClosed] = usePref("product-closed", false);
  const [draft, setDraft] = React.useState("");
  const [newKind, setNewKind] = React.useState<(typeof PRODUCT_KINDS)[number]>("feature");
  const items = index.tasks.filter((x) => (PRODUCT_KINDS as readonly string[]).includes(x.kind) && !x.parent_id && (kind === "all" || x.kind === kind) && (showClosed || !isClosedTask(x)));
  const rank = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 } as const;
  const sorted = items.slice().sort((a, b) =>
    sort === "score"
      ? (priorityScore(b) ?? -1) - (priorityScore(a) ?? -1) || rank[a.priority] - rank[b.priority]
      : sort === "priority"
        ? rank[a.priority] - rank[b.priority] || (priorityScore(b) ?? -1) - (priorityScore(a) ?? -1)
        : b.created_at.localeCompare(a.created_at),
  );

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("product.intro")}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={kind}
          onChange={setKind}
          label={t("product.kinds")}
          options={[{ value: "all" as const, label: t("product.all") }, ...PRODUCT_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))]}
        />
        <div className="flex items-center gap-2">
          <ChoiceMenu value={sort} options={["score", "priority", "recent"] as const} label={(s) => t(`product.sorts.${s}`)} onChange={(s) => s && setSort(s)} ariaLabel={t("product.sort")} className="h-8 border" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-foreground" />
            {t("filters.showClosed")}
          </label>
        </div>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const title = draft.trim();
          if (!title) return;
          const row = await actions.create("task", { title, kind: newKind, status: "triage" });
          if (row) {
            setDraft("");
            panel.open("task", row.id);
          }
        }}
      >
        <ChoiceMenu value={newKind} options={PRODUCT_KINDS} label={(k) => t(`kind.${k}`)} onChange={(k) => k && setNewKind(k)} ariaLabel={t("fields.kind")} className="h-9 border" />
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("product.newPlaceholder")} aria-label={t("product.new")} maxLength={300} className="h-9 max-w-md flex-1" />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          <PlusIcon />
          {t("product.new")}
        </Button>
      </form>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{t("product.empty")}</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("product.item")}</th>
                <th className="px-2 py-2 font-medium">{t("fields.status")}</th>
                <th className="px-2 py-2 font-medium">{t("fields.priority")}</th>
                <th className="px-2 py-2 text-center font-medium" title={t("product.scoreHint")}>
                  {t("product.ice")}
                </th>
                <th className="px-2 py-2 font-medium">{t("fields.commercial_urgency")}</th>
                <th className="px-2 py-2 font-medium">{t("product.customers")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((x) => (
                <ProductRow key={x.id} task={x} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("product.scoreNote")}</p>
    </div>
  );
}

function ProductRow({ task }: { task: Task }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const Icon = KIND_ICON[task.kind as keyof typeof KIND_ICON] ?? SparklesIcon;
  const score = priorityScore(task);
  const customers = (index.linksByEntity.get(`task:${task.id}`) ?? []).length;
  return (
    <tr className="border-t transition-colors hover:bg-accent/40">
      <td className="max-w-[22rem] px-3 py-2">
        <button type="button" onClick={() => panel.open("task", task.id)} className="flex w-full items-start gap-2 text-left">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={t(`kind.${task.kind}`)} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{task.title}</span>
            {task.why || task.expected_result ? <span className="block truncate text-xs text-muted-foreground">{task.why ?? task.expected_result}</span> : <span className="block text-xs text-muted-foreground/70">{t("product.noWhy")}</span>}
          </span>
        </button>
      </td>
      <td className="px-2 py-2">
        <TaskStatusMenu value={task.status} onChange={(status) => void actions.update("task", task.id, { status })} />
      </td>
      <td className="px-2 py-2">
        <PriorityMenu value={task.priority} onChange={(priority) => void actions.update("task", task.id, { priority })} />
      </td>
      <td className="px-2 py-2 text-center tabular-nums" title={score === null ? t("product.scoreMissing") : t("product.scoreValue", { impact: task.impact ?? 0, confidence: task.confidence ?? 0, effort: task.effort ?? 0, score })}>
        {score ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-2 text-xs">{task.commercial_urgency === "none" ? <span className="text-muted-foreground">—</span> : <span className={cn("rounded-full px-2 py-0.5", task.commercial_urgency === "blocking" ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning")}>{t(`urgency.${task.commercial_urgency}`)}</span>}</td>
      <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{customers || "—"}</td>
    </tr>
  );
}
