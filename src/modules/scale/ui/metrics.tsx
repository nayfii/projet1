"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalculatorIcon, ChartLineIcon, DatabaseIcon, MegaphoneIcon, PencilLineIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { simulate, type SimulationInputs } from "../logic/planning";
import { METRIC_PERIODS, MEASUREMENT_KINDS, type Measurement, type Metric, type MetricSource, type Simulation } from "../types";
import { AutoText, ChoiceMenu, InlineText, NotFilled, NumberField, ScalePageHeader, Segmented, useDates } from "./primitives";
import { useIndex } from "./selectors";
import { usePref, useScale, useScaleActions } from "./store";
import { ConclusionBadge, TestStatusBadge } from "./tests";

type Tab = "indicators" | "acquisition" | "simulations";

export function MetricsPage() {
  const t = useTranslations("scale.metrics");
  const [tab, setTab] = usePref<Tab>("metrics-tab", "indicators");
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <ScalePageHeader title={t("title")} description={t("description")} />
      <Segmented
        value={tab}
        onChange={setTab}
        label={t("tabs.label")}
        className="mb-6"
        options={[
          { value: "indicators", label: t("tabs.indicators"), icon: <ChartLineIcon /> },
          { value: "acquisition", label: t("tabs.acquisition"), icon: <MegaphoneIcon /> },
          { value: "simulations", label: t("tabs.simulations"), icon: <CalculatorIcon /> },
        ]}
      />
      {tab === "indicators" ? <Indicators /> : tab === "acquisition" ? <AcquisitionExperiments /> : <Simulations />}
    </div>
  );
}

// ─── Indicators ─────────────────────────────────────────────────────────────

function Indicators() {
  const t = useTranslations("scale.metrics");
  const data = useScale();
  const actions = useScaleActions();
  const [open, setOpen] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const metrics = data.metrics.filter((m) => !m.archived_at);
  const suggestionsLeft = 10 - data.metrics.filter((m) => m.template_key).length;
  const current = metrics.find((m) => m.id === open) ?? null;
  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const row = await actions.create("metric", { name: name.trim() });
            if (row) {
              setName("");
              setOpen(row.id);
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("newPlaceholder")} aria-label={t("new")} maxLength={120} className="h-9 w-64" />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            <PlusIcon />
            {t("new")}
          </Button>
        </form>
        {suggestionsLeft > 0 ? (
          <Button size="sm" variant="outline" onClick={() => void actions.addSuggestedMetrics()}>
            {t("addSuggested")}
          </Button>
        ) : null}
      </div>
      {metrics.length === 0 ? <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{t("empty")}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((m) => (
          <MetricCard key={m.id} metric={m} onOpen={() => setOpen(m.id)} />
        ))}
      </div>
      {current ? <MetricDialog metric={current} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function useMetricValue(m: Metric) {
  const data = useScale();
  const values = data.measurements.filter((x) => x.metric_id === m.id).sort((a, b) => a.period_start.localeCompare(b.period_start));
  const actual = values.filter((v) => v.kind === "actual");
  const projected = values.filter((v) => v.kind === "projection");
  const computed = m.source === "manual" ? undefined : data.computed[m.source as Exclude<MetricSource, "manual">];
  const last = actual[actual.length - 1] ?? null;
  return { values, actual, projected, computed, last };
}

function MetricCard({ metric: m, onOpen }: { metric: Metric; onOpen: () => void }) {
  const t = useTranslations("scale.metrics");
  const dates = useDates();
  const { actual, projected, computed, last } = useMetricValue(m);
  const value = computed !== undefined ? computed : last ? Number(last.value) : null;
  return (
    <button type="button" onClick={onOpen} className="flex flex-col rounded-2xl border bg-card p-4 text-left shadow-xs outline-none transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug">{m.name}</p>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t(`periods.${m.period}`)}</span>
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tabular-nums">
        {value === null || value === undefined ? <NotFilled /> : `${dates.number(value, 2)}${m.unit ? ` ${m.unit}` : ""}`}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        {m.source === "manual" ? <PencilLineIcon className="size-3.5" /> : <DatabaseIcon className="size-3.5" />}
        {m.source === "manual" ? t("manual") : t(`sources.${m.source}`)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {m.source !== "manual" ? t("computedNow") : last ? t("lastUpdate", { when: dates.relative(last.updated_at), period: dates.short(last.period_start) }) : t("never")}
      </p>
      {actual.length > 1 || projected.length ? <Spark actual={actual} projected={projected} /> : null}
    </button>
  );
}

/** A small line: actual values solid, projections dashed (never mixed). */
function Spark({ actual, projected }: { actual: Measurement[]; projected: Measurement[] }) {
  const all = [...actual, ...projected];
  const xs = [...new Set(all.map((v) => v.period_start))].sort();
  const ys = all.map((v) => Number(v.value));
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const W = 220;
  const H = 40;
  const px = (d: string) => (xs.length < 2 ? W / 2 : (xs.indexOf(d) / (xs.length - 1)) * W);
  const py = (v: number) => (max === min ? H / 2 : H - ((v - min) / (max - min)) * (H - 6) - 3);
  const path = (list: Measurement[]) => list.map((v, i) => `${i ? "L" : "M"} ${px(v.period_start).toFixed(1)} ${py(Number(v.value)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-10 w-full" aria-hidden>
      {actual.length ? <path d={path(actual)} fill="none" strokeWidth={2} className="stroke-foreground/70" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {projected.length ? <path d={path(projected)} fill="none" strokeWidth={2} strokeDasharray="4 4" className="stroke-muted-foreground/60" /> : null}
    </svg>
  );
}

function MetricDialog({ metric: m, onClose }: { metric: Metric; onClose: () => void }) {
  const t = useTranslations("scale.metrics");
  const tc = useTranslations("scale.common");
  const index = useIndex();
  const actions = useScaleActions();
  const dates = useDates();
  const { values, computed } = useMetricValue(m);
  const [period, setPeriod] = React.useState(index.today);
  const [value, setValue] = React.useState("");
  const [kind, setKind] = React.useState<(typeof MEASUREMENT_KINDS)[number]>("actual");
  const set = (patch: Partial<Metric>) => void actions.update("metric", m.id, patch);
  const n = value.trim() === "" ? null : Number(value.replace(",", "."));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} className="max-h-[88dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{m.name}</DialogTitle>
          <InlineText value={m.name} onSave={(name) => set({ name })} required maxLength={120} ariaLabel={t("name")} className="text-lg font-semibold" />
          <DialogDescription className="sr-only">{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("definition")}</span>
            <AutoText value={m.definition} onSave={(definition) => set({ definition })} ariaLabel={t("definition")} placeholder={t("definitionHint")} maxLength={1000} minRows={2} className="-mx-2" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("unit")}</span>
            <InlineText value={m.unit ?? ""} onSave={(unit) => set({ unit: unit || null })} maxLength={30} ariaLabel={t("unit")} placeholder="€, %, …" className="h-7 w-24 text-[13px]" />
            <span className="text-xs text-muted-foreground">{t("period")}</span>
            <ChoiceMenu value={m.period as (typeof METRIC_PERIODS)[number]} options={METRIC_PERIODS} label={(p) => t(`periods.${p}`)} onChange={(p) => p && set({ period: p })} ariaLabel={t("period")} className="border" />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {m.source === "manual" ? <PencilLineIcon className="size-3.5" /> : <DatabaseIcon className="size-3.5" />}
            {m.source === "manual" ? t("manualLong") : t("computedLong", { source: t(`sources.${m.source}`) })}
          </p>
          {computed !== undefined ? (
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("currentComputed")}</p>
              <p className="text-xl font-semibold tabular-nums">{computed === null ? <NotFilled>{t("sourceUnavailable")}</NotFilled> : `${dates.number(computed, 2)}${m.unit ? ` ${m.unit}` : ""}`}</p>
              {computed !== null ? (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void actions.create("measurement", { metric_id: m.id, period_start: index.today, value: computed, kind: "actual", note: t("snapshotNote") })}>
                  {t("snapshot")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("values")}</p>
            {values.length === 0 ? <p className="text-sm text-muted-foreground">{t("noValues")}</p> : null}
            <ul className="divide-y rounded-lg border">
              {values
                .slice()
                .reverse()
                .map((v) => (
                  <li key={v.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-24 text-xs text-muted-foreground">{dates.short(v.period_start)}</span>
                    <span className={cn("flex-1 tabular-nums", v.kind === "projection" && "italic text-muted-foreground")}>
                      {dates.number(Number(v.value), 2)}
                      {m.unit ? ` ${m.unit}` : ""}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px]", v.kind === "actual" ? "bg-foreground text-background" : "border border-dashed text-muted-foreground")}>{t(`kinds.${v.kind}`)}</span>
                    <button type="button" aria-label={t("removeValue")} onClick={() => void actions.remove("measurement", v.id)} className="rounded p-1 text-muted-foreground hover:bg-accent">
                      <XIcon className="size-3.5" />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
          <form
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              if (n === null || !Number.isFinite(n)) return;
              if (await actions.create("measurement", { metric_id: m.id, period_start: period, value: n, kind })) setValue("");
            }}
          >
            <Input type="date" value={period} onChange={(e) => setPeriod(e.target.value || index.today)} aria-label={t("periodStart")} className="h-9" />
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("value")} aria-label={t("value")} className="h-9" />
            <ChoiceMenu value={kind} options={MEASUREMENT_KINDS} label={(k) => t(`kinds.${k}`)} onChange={(k) => k && setKind(k)} ariaLabel={t("kind")} className="h-9 border" />
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("addHint")}</p>
            <Button type="submit" size="sm" disabled={n === null || !Number.isFinite(n)}>
              {t("addValue")}
            </Button>
          </form>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (await actions.archive("metric", m.id, true)) onClose();
              }}
            >
              <Trash2Icon />
              {t("archive")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Acquisition experiments (tests of the acquisition category) ────────────

function AcquisitionExperiments() {
  const t = useTranslations("scale");
  const index = useIndex();
  const actions = useScaleActions();
  const router = useRouter();
  const dates = useDates();
  const experiments = index.tests.filter((x) => x.category === "acquisition");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("acquisition.intro")}</p>
        <Button
          size="sm"
          onClick={async () => {
            const row = await actions.createTestFromTemplate("channel", null);
            if (row) router.push(`/scale/tests/${row.id}`);
          }}
        >
          <PlusIcon />
          {t("acquisition.new")}
        </Button>
      </div>
      {experiments.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{t("acquisition.empty")}</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("fields.channel")}</th>
                <th className="px-2 py-2 font-medium">{t("fields.hypothesis")}</th>
                <th className="px-2 py-2 font-medium">{t("fields.audience")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("acquisition.planned")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("acquisition.actual")}</th>
                <th className="px-2 py-2 font-medium">{t("fields.status")}</th>
                <th className="px-2 py-2 font-medium">{t("fields.continuation")}</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((x) => (
                <tr key={x.id} className="border-t align-top hover:bg-accent/40">
                  <td className="px-3 py-2">
                    <Link href={`/scale/tests/${x.id}`} className="font-medium hover:underline">
                      {x.channel ?? x.title}
                    </Link>
                    {x.results ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{x.results}</p> : null}
                  </td>
                  <td className="max-w-[16rem] px-2 py-2 text-xs">{x.hypothesis ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="max-w-[12rem] px-2 py-2 text-xs">{x.audience ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{x.budget_planned === null ? "—" : dates.money(Number(x.budget_planned))}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{x.budget_actual === null ? "—" : dates.money(Number(x.budget_actual))}</td>
                  <td className="px-2 py-2">
                    <TestStatusBadge status={x.status} />
                    {x.conclusion ? (
                      <span className="mt-1 block">
                        <ConclusionBadge conclusion={x.conclusion} />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-xs">{x.continuation ? t(`continuation.${x.continuation}`) : <span className="text-muted-foreground">{t("continuation.none")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Simulations: simple hypotheses, visible formulas ───────────────────────

const INPUTS: (keyof SimulationInputs)[] = ["pricePerUser", "usersPerCustomer", "customers", "variableCostPerUser", "fixedCosts"];

function Simulations() {
  const t = useTranslations("scale.simulations");
  const data = useScale();
  const actions = useScaleActions();
  const sims = data.simulations.filter((s) => !s.archived_at);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
        <Button size="sm" onClick={() => void actions.create("simulation", { name: t("untitled", { n: sims.length + 1 }), inputs: {} })}>
          <PlusIcon />
          {t("new")}
        </Button>
      </div>
      {sims.length === 0 ? <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{t("empty")}</div> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {sims.map((s) => (
          <SimulationCard key={s.id} sim={s} />
        ))}
      </div>
    </div>
  );
}

function SimulationCard({ sim }: { sim: Simulation }) {
  const t = useTranslations("scale.simulations");
  const actions = useScaleActions();
  const dates = useDates();
  const inputs = (sim.inputs ?? {}) as Record<string, number | null>;
  const i: SimulationInputs = Object.fromEntries(INPUTS.map((k) => [k, typeof inputs[k] === "number" ? inputs[k] : null])) as SimulationInputs;
  const r = simulate(i);
  const money = (v: number | null) => (v === null ? <NotFilled /> : dates.money(v));
  const setInput = (k: keyof SimulationInputs, v: number | null) => void actions.update("simulation", sim.id, { inputs: { ...inputs, [k]: v } });
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-xs">
      <div className="flex items-start gap-2">
        <InlineText value={sim.name} onSave={(name) => void actions.update("simulation", sim.id, { name })} required maxLength={120} ariaLabel={t("name")} className="font-semibold" />
        <span className="shrink-0 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">{t("projection")}</span>
        <button type="button" aria-label={t("archive")} onClick={() => void actions.archive("simulation", sim.id, true)} className="rounded p-1 text-muted-foreground hover:bg-accent">
          <Trash2Icon className="size-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("monthly")}</p>
      <div className="mt-4 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {INPUTS.map((k) => (
          <label key={k} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="text-muted-foreground">{t(`inputs.${k}`)}</span>
            <NumberField value={i[k]} onSave={(v) => setInput(k, v)} ariaLabel={t(`inputs.${k}`)} placeholder="—" min={0} />
          </label>
        ))}
      </div>
      <dl className="mt-5 space-y-2 border-t pt-4 text-sm">
        {[
          ["users", r.users === null ? <NotFilled key="u" /> : dates.number(r.users, 0)],
          ["revenue", money(r.revenue)],
          ["variableCosts", money(r.variableCosts)],
          ["contribution", money(r.contribution)],
          ["margin", money(r.margin)],
          ["marginRate", r.marginRate === null ? <NotFilled key="m" /> : dates.percent(r.marginRate)],
          ["breakEven", r.breakEvenCustomers === null ? <NotFilled key="b" /> : t("customersCount", { count: r.breakEvenCustomers })],
        ].map(([k, v]) => (
          <div key={k as string} className="flex items-start justify-between gap-3">
            <dt>
              <span className="block">{t(`outputs.${k as string}` as Parameters<typeof t>[0])}</span>
              <span className="block font-mono text-[11px] text-muted-foreground">{t(`formulas.${k as string}` as Parameters<typeof t>[0])}</span>
            </dt>
            <dd className={cn("shrink-0 font-medium tabular-nums", k === "margin" && r.margin !== null && r.margin < 0 && "text-destructive")}>{v}</dd>
          </div>
        ))}
      </dl>
      <AutoText value={sim.note} onSave={(note) => void actions.update("simulation", sim.id, { note })} ariaLabel={t("note")} placeholder={t("noteHint")} maxLength={2000} minRows={1} className="-mx-2 mt-3 text-[13px]" />
    </section>
  );
}
