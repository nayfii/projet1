"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArchiveIcon, ArchiveRestoreIcon, ChevronLeftIcon, CircleAlertIcon, CopyIcon, EllipsisIcon, ListTodoIcon, PlusIcon, ScaleIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { testHints, testUsesComparison } from "../templates";
import * as server from "../server/actions";
import { CONCLUSIONS, CONTINUATIONS, OBSERVATION_KINDS, TEST_CATEGORIES, TEST_STATUSES, type Activity, type Comparison, type Conclusion, type Test } from "../types";
import { CompanyLinks, EntityExtras } from "./details";
import { AutoText, ChoiceMenu, DateField, Field, InlineText, NumberField, PersonMenu, RecordMenu, SectionTitle, useDates } from "./primitives";
import { useIndex } from "./selectors";
import { usePanel, useScale, useScaleActions } from "./store";
import { ConclusionBadge } from "./tests";

/** A test sheet: what we believe, how we check it, what we saw, and what we decide. */
export function TestPage({ id }: { id: string }) {
  const t = useTranslations("scale");
  const locale = useLocale() === "en" ? "en" : "fr";
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const router = useRouter();
  const dates = useDates();
  const test = data.tests.find((x) => x.id === id);
  const [showComparison, setShowComparison] = React.useState(false);
  // Changes of the success criterion after the start are kept in the history and shown here.
  const [changes, setChanges] = React.useState<Activity[]>([]);
  const criterion = test?.success_criterion;
  React.useEffect(() => {
    let live = true;
    void server.getDetails("test", id).then((res) => live && res.ok && setChanges(res.data.activity));
    return () => {
      live = false;
    };
  }, [id, criterion]);
  if (!test) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-muted-foreground">{t("test.missing")}</p>
        <Button asChild size="sm" variant="outline" className="mt-4">
          <Link href="/scale/tests">{t("test.back")}</Link>
        </Button>
      </div>
    );
  }
  const set = (patch: Partial<Test>) => void actions.update("test", test.id, patch);
  const hints = testHints(test.template_key, locale);
  const comparisons = data.comparisons.filter((c) => c.test_id === test.id);
  const withComparison = showComparison || comparisons.length > 0 || testUsesComparison(test.template_key);
  const started = Boolean(test.started_at);
  const criterionChanges = changes.filter((a) => a.action === "criterion_changed");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href="/scale/tests" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" />
          {t("test.back")}
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
                const newId = await actions.duplicate("test", test.id);
                if (newId) router.push(`/scale/tests/${newId}`);
              }}
            >
              <CopyIcon />
              {t("panel.duplicate")}
            </DropdownMenuItem>
            {test.archived_at ? (
              <>
                <DropdownMenuItem onSelect={() => void actions.archive("test", test.id, false)}>
                  <ArchiveRestoreIcon />
                  {t("panel.restore")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={async () => {
                    if (window.confirm(t("panel.deleteConfirm")) && (await actions.remove("test", test.id))) router.push("/scale/tests");
                  }}
                >
                  <Trash2Icon />
                  {t("panel.delete")}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={() => void actions.archive("test", test.id, true)}>
                <ArchiveIcon />
                {t("panel.archive")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {test.archived_at ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <ArchiveIcon className="size-4" />
          <span className="flex-1">{t("panel.archivedNotice")}</span>
          <Button size="sm" variant="outline" onClick={() => void actions.archive("test", test.id, false)}>
            {t("panel.restore")}
          </Button>
        </div>
      ) : null}

      <InlineText value={test.title} onSave={(title) => set({ title })} required maxLength={200} ariaLabel={t("fields.title")} className="-ml-1 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]" />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ChoiceMenu value={test.status as (typeof TEST_STATUSES)[number]} options={TEST_STATUSES} label={(s) => t(`testStatus.${s}`)} onChange={(status) => status && set({ status })} ariaLabel={t("fields.status")} className="border" />
        <ChoiceMenu value={test.category as (typeof TEST_CATEGORIES)[number] | null} options={TEST_CATEGORIES} label={(c) => t(`category.${c}`)} onChange={(category) => set({ category })} allowNone noneLabel={t("category.none")} ariaLabel={t("fields.category")} />
        <PersonMenu value={test.owner_id} team={data.team} onChange={(owner_id) => set({ owner_id })} />
        <DateField value={test.start_date} onChange={(start_date) => set({ start_date })} label={t("fields.start_date")} placeholder={t("fields.start_date")} />
        <span className="text-muted-foreground">{"→"}</span>
        <DateField value={test.end_date} onChange={(end_date) => set({ end_date })} label={t("fields.end_date")} placeholder={t("fields.end_date")} min={test.start_date} />
        <span className="ml-auto">
          <ConclusionBadge conclusion={test.conclusion as Conclusion | null} />
        </span>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          {/* 1. What we believe */}
          <section className="rounded-2xl border border-l-4 border-l-warning/70 bg-warning-soft/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-warning">{t("test.hypothesis")}</p>
            <AutoText value={test.hypothesis} onSave={(hypothesis) => set({ hypothesis })} ariaLabel={t("fields.hypothesis")} placeholder={hints?.hypothesis ?? t("test.hypothesisHint")} maxLength={2000} minRows={2} className="-mx-2 mt-1 text-[15px]" />
            <p className="mt-3 text-xs font-medium text-muted-foreground">{t("fields.importance")}</p>
            <AutoText value={test.importance} onSave={(importance) => set({ importance })} ariaLabel={t("fields.importance")} placeholder={t("test.importanceHint")} maxLength={2000} minRows={1} className="-mx-2" />
          </section>

          {/* 2. How we check it */}
          <section className="space-y-4">
            <SectionTitle>{t("test.method")}</SectionTitle>
            <Field label={t("fields.protocol")}>
              <AutoText value={test.protocol} onSave={(protocol) => set({ protocol })} ariaLabel={t("fields.protocol")} placeholder={t("test.protocolHint")} maxLength={10000} minRows={3} />
            </Field>
            <Field label={t("fields.segment")}>
              <AutoText value={test.segment} onSave={(segment) => set({ segment })} ariaLabel={t("fields.segment")} placeholder={t("test.segmentHint")} maxLength={1000} minRows={1} />
            </Field>
            <Field label={t("fields.metrics")}>
              <AutoText value={test.metrics} onSave={(metrics) => set({ metrics })} ariaLabel={t("fields.metrics")} placeholder={t("test.metricsHint")} maxLength={2000} minRows={1} />
            </Field>
            <Field label={t("fields.baseline")}>
              <AutoText value={test.baseline} onSave={(baseline) => set({ baseline })} ariaLabel={t("fields.baseline")} placeholder={hints?.baseline ?? t("test.baselineHint")} maxLength={2000} minRows={1} />
            </Field>
          </section>

          {/* 3. The success criterion, set before the test */}
          <section className="rounded-2xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("fields.success_criterion")}</p>
              {started ? <span className="text-xs text-muted-foreground">{t("test.criterionLocked")}</span> : <span className="text-xs text-muted-foreground">{t("test.criterionBefore")}</span>}
            </div>
            <AutoText value={test.success_criterion} onSave={(success_criterion) => set({ success_criterion })} ariaLabel={t("fields.success_criterion")} placeholder={hints?.success ?? t("test.criterionHint")} maxLength={2000} minRows={2} className="-mx-2 mt-1" />
            {criterionChanges.length ? (
              <div className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
                <p className="flex items-center gap-1.5 font-medium">
                  <CircleAlertIcon className="size-4" />
                  {t("test.criterionChanged", { count: criterionChanges.length })}
                </p>
                <ul className="mt-1 space-y-1">
                  {criterionChanges.map((a) => {
                    const d = a.details as { from?: string | null; to?: string | null };
                    return (
                      <li key={a.id}>
                        {t("test.criterionChange", { when: dates.relative(a.created_at), from: d.from ?? "—", to: d.to ?? "—" })}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </section>

          {withComparison ? <ComparisonTable test={test} rows={comparisons} /> : (
            <Button size="sm" variant="outline" onClick={() => setShowComparison(true)}>
              <PlusIcon />
              {t("test.addComparison")}
            </Button>
          )}

          <Observations test={test} />

          {/* 4. What we saw */}
          <section className="space-y-4">
            <SectionTitle>{t("test.outcome")}</SectionTitle>
            <Field label={t("fields.results")}>
              <AutoText value={test.results} onSave={(results) => set({ results })} ariaLabel={t("fields.results")} placeholder={t("test.resultsHint")} minRows={3} />
            </Field>
            <Field label={t("fields.limits")}>
              <AutoText value={test.limits} onSave={(limits) => set({ limits })} ariaLabel={t("fields.limits")} placeholder={t("test.limitsHint")} maxLength={5000} minRows={1} />
            </Field>
          </section>

          {/* 5. The conclusion: chosen by a person, separate from the status */}
          <section className="rounded-2xl border p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("fields.conclusion")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("test.conclusionNote")}</p>
            <div role="radiogroup" aria-label={t("fields.conclusion")} className="mt-3 flex flex-wrap gap-2">
              {CONCLUSIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={test.conclusion === c}
                  onClick={() => set({ conclusion: test.conclusion === c ? null : c })}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    test.conclusion === c
                      ? c === "supported"
                        ? "border-success bg-success-soft font-medium text-success"
                        : c === "not_supported"
                          ? "border-destructive bg-destructive-soft font-medium text-destructive"
                          : "border-warning bg-warning-soft font-medium text-warning"
                      : "hover:bg-accent",
                  )}
                >
                  {t(`conclusion.${c}`)}
                </button>
              ))}
            </div>
            {test.status === "done" && !test.conclusion ? <p className="mt-2 text-[13px] text-warning">{t("test.doneNoConclusion")}</p> : null}
            <AutoText value={test.conclusion_note} onSave={(conclusion_note) => set({ conclusion_note })} ariaLabel={t("fields.conclusion_note")} placeholder={t("test.conclusionNoteHint")} maxLength={5000} minRows={2} className="-mx-2 mt-2" />
          </section>

          <NextSteps test={test} />
          {test.category === "acquisition" ? <Acquisition test={test} /> : null}
        </div>

        <aside className="space-y-6">
          <div className="space-y-0.5">
            <Field label={t("fields.project_id")}>
              <RecordMenu value={test.project_id} items={index.projects.map((p) => ({ id: p.id, label: p.title }))} onChange={(project_id) => set({ project_id })} noneLabel={t("common.none")} ariaLabel={t("fields.project_id")} />
            </Field>
            <Field label={t("fields.objective_id")}>
              <RecordMenu value={test.objective_id} items={index.objectives.map((o) => ({ id: o.id, label: o.title }))} onChange={(objective_id) => set({ objective_id })} noneLabel={t("common.none")} ariaLabel={t("fields.objective_id")} />
            </Field>
          </div>
          <section>
            <SectionTitle>{t("test.customers")}</SectionTitle>
            <CompanyLinks entityType="test" entityId={test.id} roles={["participant", "pilot", "feedback", "other"]} />
          </section>
          <section>
            <SectionTitle>{t("test.evidence")}</SectionTitle>
            <EntityExtras type="test" id={test.id} />
          </section>
        </aside>
      </div>
    </div>
  );
}

// ─── With and without Cendr ─────────────────────────────────────────────────

function ComparisonTable({ test, rows }: { test: Test; rows: Comparison[] }) {
  const t = useTranslations("scale.comparison");
  const actions = useScaleActions();
  const dates = useDates();
  const [label, setLabel] = React.useState("");
  const delta = (a: number | null, b: number | null) => (a === null || b === null || a === 0 ? null : (b - a) / a);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="space-y-3">
        {rows.map((r) => {
          const timeDelta = delta(num(r.without_minutes), num(r.with_minutes));
          const costDelta = delta(num(r.without_cost), num(r.with_cost));
          const set = (patch: Partial<Comparison>) => void actions.update("comparison", r.id, patch);
          return (
            <div key={r.id} className="rounded-2xl border p-4">
              <div className="flex items-start gap-2">
                <InlineText value={r.label} onSave={(v) => set({ label: v })} required maxLength={200} ariaLabel={t("label")} className="font-medium" />
                <button type="button" aria-label={t("remove", { name: r.label })} onClick={() => void actions.remove("comparison", r.id)} className="rounded p-1 text-muted-foreground hover:bg-accent">
                  <XIcon className="size-4" />
                </button>
              </div>
              <AutoText value={r.conditions} onSave={(conditions) => set({ conditions })} ariaLabel={t("conditions")} placeholder={t("conditionsHint")} maxLength={2000} minRows={1} className="-mx-2 mt-1 text-[13px]" />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[30rem] text-[13px]">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium" />
                      <th className="py-1 font-medium">{t("without")}</th>
                      <th className="py-1 font-medium">{t("with")}</th>
                      <th className="py-1 font-medium">{t("difference")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1 text-muted-foreground">{t("time")}</td>
                      <td><NumberField value={num(r.without_minutes)} onSave={(v) => set({ without_minutes: v })} ariaLabel={`${t("time")} ${t("without")}`} placeholder="—" suffix={t("min")} min={0} /></td>
                      <td><NumberField value={num(r.with_minutes)} onSave={(v) => set({ with_minutes: v })} ariaLabel={`${t("time")} ${t("with")}`} placeholder="—" suffix={t("min")} min={0} /></td>
                      <td className="tabular-nums">{timeDelta === null ? "—" : <span className={timeDelta <= 0 ? "text-success" : "text-destructive"}>{timeDelta > 0 ? "+" : ""}{dates.percent(timeDelta)}</span>}</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-muted-foreground">{t("cost")}</td>
                      <td><NumberField value={num(r.without_cost)} onSave={(v) => set({ without_cost: v })} ariaLabel={`${t("cost")} ${t("without")}`} placeholder="—" suffix="€" min={0} /></td>
                      <td><NumberField value={num(r.with_cost)} onSave={(v) => set({ with_cost: v })} ariaLabel={`${t("cost")} ${t("with")}`} placeholder="—" suffix="€" min={0} /></td>
                      <td className="tabular-nums">{costDelta === null ? "—" : <span className={costDelta <= 0 ? "text-success" : "text-destructive"}>{costDelta > 0 ? "+" : ""}{dates.percent(costDelta)}</span>}</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-muted-foreground">{t("quality")}</td>
                      <td><NumberField value={r.without_quality} onSave={(v) => set({ without_quality: v === null ? null : Math.round(v) })} ariaLabel={`${t("quality")} ${t("without")}`} placeholder="—" suffix="/5" min={1} max={5} step="1" /></td>
                      <td><NumberField value={r.with_quality} onSave={(v) => set({ with_quality: v === null ? null : Math.round(v) })} ariaLabel={`${t("quality")} ${t("with")}`} placeholder="—" suffix="/5" min={1} max={5} step="1" /></td>
                      <td className="tabular-nums">{r.with_quality !== null && r.without_quality !== null ? `${r.with_quality - r.without_quality > 0 ? "+" : ""}${r.with_quality - r.without_quality}` : "—"}</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-muted-foreground">{t("corrections")}</td>
                      <td><NumberField value={r.without_corrections} onSave={(v) => set({ without_corrections: v === null ? null : Math.round(v) })} ariaLabel={`${t("corrections")} ${t("without")}`} placeholder="—" min={0} step="1" /></td>
                      <td><NumberField value={r.with_corrections} onSave={(v) => set({ with_corrections: v === null ? null : Math.round(v) })} ariaLabel={`${t("corrections")} ${t("with")}`} placeholder="—" min={0} step="1" /></td>
                      <td className="tabular-nums">{r.with_corrections !== null && r.without_corrections !== null ? `${r.with_corrections - r.without_corrections > 0 ? "+" : ""}${r.with_corrections - r.without_corrections}` : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <AutoText value={r.notes} onSave={(notes) => set({ notes })} ariaLabel={t("notes")} placeholder={t("notesHint")} maxLength={2000} minRows={1} className="-mx-2 mt-2 text-[13px]" />
            </div>
          );
        })}
      </div>
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!label.trim()) return;
          if (await actions.create("comparison", { test_id: test.id, label: label.trim(), sort_order: rows.length + 1 })) setLabel("");
        }}
      >
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("addPlaceholder")} aria-label={t("add")} maxLength={200} className="h-9 max-w-sm" />
        <Button type="submit" size="sm" variant="outline" disabled={!label.trim()}>
          <PlusIcon />
          {t("add")}
        </Button>
      </form>
    </section>
  );
}

// ─── Observations ───────────────────────────────────────────────────────────

function Observations({ test }: { test: Test }) {
  const t = useTranslations("scale.observations");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const dates = useDates();
  const items = data.observations.filter((o) => o.test_id === test.id);
  const [body, setBody] = React.useState("");
  const [kind, setKind] = React.useState<(typeof OBSERVATION_KINDS)[number]>("fact");
  const [day, setDay] = React.useState(index.today);
  return (
    <section>
      <SectionTitle>{t("title", { count: items.length })}</SectionTitle>
      <p className="mb-2 text-xs text-muted-foreground">{t("intro")}</p>
      <ul className="space-y-2">
        {items.map((o) => (
          <li key={o.id} className={cn("group rounded-xl border-l-4 bg-card px-3 py-2", o.kind === "quote" ? "border-l-muted-foreground/40" : o.kind === "measure" ? "border-l-foreground/60" : "border-l-success")}>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{t(`kinds.${o.kind}`)}</span>· {dates.short(o.observed_on)}
              <button type="button" aria-label={t("remove")} onClick={() => void actions.remove("observation", o.id)} className="ml-auto rounded p-0.5 opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100">
                <XIcon className="size-3.5" />
              </button>
            </p>
            <p className={cn("whitespace-pre-wrap text-sm", o.kind === "quote" && "italic")}>{o.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 space-y-2 rounded-xl border p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          if (await actions.create("observation", { test_id: test.id, body: body.trim(), kind, observed_on: day })) setBody("");
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceMenu value={kind} options={OBSERVATION_KINDS} label={(k) => t(`kinds.${k}`)} onChange={(k) => k && setKind(k)} ariaLabel={t("kind")} className="border" />
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value || index.today)} aria-label={t("date")} className="h-8 w-40 text-[13px]" />
        </div>
        <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder={t("placeholder")} aria-label={t("add")} />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim()}>
            {t("add")}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ─── From a result: a decision or a task, already linked ────────────────────

function NextSteps({ test }: { test: Test }) {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const decisions = data.decisions.filter((d) => d.test_id === test.id && !d.archived_at);
  const tasks = index.tasks.filter((x) => x.test_id === test.id);
  const evidence = `${t("test.evidenceFrom", { title: test.title })}${test.conclusion ? ` — ${t(`conclusion.${test.conclusion}`)}` : ""}`;
  return (
    <section className="space-y-3">
      <SectionTitle>{t("test.nextSteps")}</SectionTitle>
      <AutoText value={test.next_actions} onSave={(next_actions) => void actions.update("test", test.id, { next_actions })} ariaLabel={t("fields.next_actions")} placeholder={t("test.nextActionsHint")} maxLength={5000} minRows={2} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const row = await actions.create("decision", { subject: t("test.decisionSubject", { title: test.title }), test_id: test.id, project_id: test.project_id, evidence });
            if (row) panel.open("decision", row.id);
          }}
        >
          <ScaleIcon />
          {t("test.createDecision")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const first = test.next_actions?.split("\n").map((l) => l.replace(/^[-•*\d.\s]+/, "").trim()).find(Boolean);
            const row = await actions.create("task", { title: (first ?? t("test.followUp", { title: test.title })).slice(0, 300), test_id: test.id, project_id: test.project_id, status: "todo" });
            if (row) panel.open("task", row.id);
          }}
        >
          <ListTodoIcon />
          {t("test.createTask")}
        </Button>
      </div>
      {decisions.length || tasks.length ? (
        <ul className="space-y-1">
          {decisions.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => panel.open("decision", d.id)} className="flex items-center gap-2 text-sm hover:underline">
                <ScaleIcon className="size-4 text-muted-foreground" />
                {d.subject} <span className="text-xs text-muted-foreground">· {t(`decisionStatus.${d.status}`)}</span>
              </button>
            </li>
          ))}
          {tasks.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => panel.open("task", x.id)} className="flex items-center gap-2 text-sm hover:underline">
                <ListTodoIcon className="size-4 text-muted-foreground" />
                {x.title} <span className="text-xs text-muted-foreground">· {t(`taskStatus.${x.status}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Acquisition({ test }: { test: Test }) {
  const t = useTranslations("scale");
  const actions = useScaleActions();
  const set = (patch: Partial<Test>) => void actions.update("test", test.id, patch);
  return (
    <section className="space-y-1 rounded-2xl border p-4">
      <SectionTitle>{t("acquisition.title")}</SectionTitle>
      <Field label={t("fields.channel")}>
        <InlineText value={test.channel ?? ""} onSave={(channel) => set({ channel: channel || null })} ariaLabel={t("fields.channel")} placeholder={t("acquisition.channelHint")} maxLength={120} className="h-7 text-[13px]" />
      </Field>
      <Field label={t("fields.audience")}>
        <AutoText value={test.audience} onSave={(audience) => set({ audience })} ariaLabel={t("fields.audience")} maxLength={1000} minRows={1} />
      </Field>
      <Field label={t("acquisition.budget")}>
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
          <label className="flex items-center gap-1">
            {t("acquisition.planned")}
            <NumberField value={test.budget_planned === null ? null : Number(test.budget_planned)} onSave={(budget_planned) => set({ budget_planned })} ariaLabel={t("fields.budget_planned")} placeholder="—" suffix="€" min={0} />
          </label>
          <label className="flex items-center gap-1">
            {t("acquisition.actual")}
            <NumberField value={test.budget_actual === null ? null : Number(test.budget_actual)} onSave={(budget_actual) => set({ budget_actual })} ariaLabel={t("fields.budget_actual")} placeholder="—" suffix="€" min={0} />
          </label>
        </div>
      </Field>
      <Field label={t("fields.continuation")}>
        <ChoiceMenu value={test.continuation as (typeof CONTINUATIONS)[number] | null} options={CONTINUATIONS} label={(c) => t(`continuation.${c}`)} onChange={(continuation) => set({ continuation })} allowNone noneLabel={t("continuation.none")} ariaLabel={t("fields.continuation")} />
      </Field>
    </section>
  );
}
