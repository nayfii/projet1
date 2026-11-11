"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArchiveIcon, CalendarClockIcon, CheckIcon, CrosshairIcon, FlagIcon, GanttChartIcon, ListIcon, MapIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addDays, diffDays } from "../logic/dates";
import { dueTone } from "../logic/plan";
import { CARD_PX, dateAt, monthTicks, packRows, timelineRange, widthOf, xOf, ZOOMS, type Zoom } from "../logic/timeline";
import type { Category, Milestone } from "../types";
import { CategoryGlyph, EmptyNote, isoToDate, PageHeader, ProgressBar, Segmented, useCategoryName, useDates, useToday } from "./primitives";
import { useShell } from "./shell";
import { useIndex } from "./selectors";
import { usePanel, usePref, useStudio, useStudioActions } from "./store";

type View = "timeline" | "list";
const LANE_LABEL_PX = 152;
const ROW_PX = 60;
const LANE_PAD = 12;
const HEADER_PX = 40;

/**
 * The Roadmap: months across, one line per category, each milestone at its target date with its
 * progress (counted from its tasks). Drag a milestone to change its date (its tasks keep theirs);
 * those without a date wait in "To schedule".
 */
export function RoadmapPage() {
  const t = useTranslations("studio.roadmap");
  const data = useStudio();
  const shell = useShell();
  const [view, setView] = usePref<View>("roadmap-view", "timeline");
  const [zoom, setZoom] = usePref<Zoom>("roadmap-zoom", "month");
  const [showArchived, setShowArchived] = React.useState(false);
  const live = data.milestones.filter((m) => !m.archived_at);
  const archived = data.milestones.filter((m) => m.archived_at);
  const ahead = live.filter((m) => m.status !== "done").length;

  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-8 sm:py-10">
      <PageHeader
        title={t("title")}
        description={live.length ? t("summary", { ahead, done: live.length - ahead }) : t("summaryEmpty")}
        actions={
          <>
            {view === "timeline" && live.length ? (
              <Segmented value={zoom} onChange={setZoom} label={t("zoom")} options={ZOOMS.map((z) => ({ value: z, label: t(`zooms.${z}`) }))} />
            ) : null}
            <Segmented
              value={view}
              onChange={setView}
              label={t("views")}
              options={[
                { value: "timeline", label: t("timeline"), icon: <GanttChartIcon /> },
                { value: "list", label: t("list"), icon: <ListIcon /> },
              ]}
            />
            <Button size="sm" onClick={() => shell.create("milestone")}>
              <PlusIcon />
              {t("add")}
            </Button>
          </>
        }
      />

      {live.length === 0 ? (
        <EmptyNote
          icon={<MapIcon />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Button size="sm" onClick={() => shell.create("milestone")}>
              <PlusIcon />
              {t("add")}
            </Button>
          }
        />
      ) : view === "timeline" ? (
        <Timeline milestones={live} zoom={zoom} />
      ) : (
        <ChronoList milestones={live} />
      )}

      {archived.length ? (
        <div className="mt-8">
          <Button variant="ghost" size="sm" className="text-[13px] text-muted-foreground" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
            <ArchiveIcon />
            {t("archived", { count: archived.length })}
          </Button>
          {showArchived ? <ChronoList milestones={archived} compact /> : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Timeline ───────────────────────────────────────────────────────────────

type Lane = { key: string; category: Category | null; items: Milestone[] };

function useLanes(milestones: Milestone[]): Lane[] {
  const data = useStudio();
  return React.useMemo(() => {
    const dated = milestones.filter((m) => m.target_date);
    const lanes: Lane[] = data.categories
      .map((c) => ({ key: c.id, category: c, items: dated.filter((m) => m.category_id === c.id) }))
      .filter((l) => l.items.length);
    const known = new Set(data.categories.map((c) => c.id));
    const loose = dated.filter((m) => !m.category_id || !known.has(m.category_id));
    if (loose.length) lanes.push({ key: "none", category: null, items: loose });
    return lanes;
  }, [milestones, data.categories]);
}

function Timeline({ milestones, zoom }: { milestones: Milestone[]; zoom: Zoom }) {
  const t = useTranslations("studio.roadmap");
  const format = useFormatter();
  const today = useToday();
  const actions = useStudioActions();
  const name = useCategoryName();
  const lanes = useLanes(milestones);
  const unscheduled = milestones.filter((m) => !m.target_date).sort((a, b) => a.sort_order - b.sort_order);
  const range = timelineRange(milestones.map((m) => m.target_date), today, zoom);
  const width = widthOf(range.start, range.end, zoom);
  const ticks = monthTicks(range.start, range.end, zoom);
  const scroller = React.useRef<HTMLDivElement>(null);
  const [dropX, setDropX] = React.useState<number | null>(null);

  const start = range.start;
  const todayX = xOf(today, start, zoom);
  const scrollToToday = (smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - LANE_LABEL_PX) * 0.25), behavior: smooth ? "smooth" : "auto" });
  };
  // Opening (or changing the scale): today sits a quarter of the way in.
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, todayX - (el.clientWidth - LANE_LABEL_PX) * 0.25);
  }, [todayX]);

  /** The date under a pointer position (for a milestone dropped from "To schedule"). */
  const dateFromClientX = (clientX: number) => {
    const el = scroller.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - LANE_LABEL_PX;
    return dateAt(Math.max(0, x), range.start, zoom);
  };

  const monthLabel = (iso: string) =>
    format.dateTime(isoToDate(iso), zoom === "year" ? { month: "narrow" } : zoom === "quarter" ? { month: "short" } : { month: "long", year: iso.slice(5, 7) === "01" || iso === ticks[0]?.iso ? "numeric" : undefined });

  return (
    <div className="space-y-4">
      {unscheduled.length ? (
        <div className="rounded-xl border border-dashed p-3">
          <p className="mb-2 flex items-center gap-2 px-1 text-[13px] font-medium">
            <CalendarClockIcon className="size-4 text-muted-foreground" />
            {t("toSchedule")}
            <span className="font-normal text-muted-foreground">{t("toScheduleHint")}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((m) => (
              <UnscheduledChip key={m.id} milestone={m} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-[13px] text-muted-foreground" onClick={() => scrollToToday(true)}>
          <CrosshairIcon />
          {t("today")}
        </Button>
      </div>
      <div className="relative -mt-2 overflow-hidden rounded-xl border bg-card/30">
        <div
          ref={scroller}
          data-testid="roadmap-timeline"
          className="relative overflow-x-auto overscroll-x-contain"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("application/x-studio-milestone")) return;
            e.preventDefault();
            const el = scroller.current!;
            setDropX(e.clientX - el.getBoundingClientRect().left + el.scrollLeft);
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropX(null);
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("application/x-studio-milestone");
            setDropX(null);
            if (!id) return;
            e.preventDefault();
            void actions.updateMilestone(id, { target_date: dateFromClientX(e.clientX) });
          }}
        >
          <div className="relative" style={{ width: width + LANE_LABEL_PX }}>
            {/* Months */}
            <div className="sticky top-0 z-20 flex border-b bg-background/90 backdrop-blur" style={{ height: HEADER_PX }}>
              <div className="sticky left-0 z-10 shrink-0 border-r bg-background" style={{ width: LANE_LABEL_PX }} />
              <div className="relative" style={{ width }}>
                {ticks.map((m) => (
                  <div key={m.iso} className="absolute inset-y-0 flex items-center border-l border-border/60 text-xs text-muted-foreground" style={{ left: m.x, width: m.width }}>
                    {/* The month's name stays readable while its month is partly scrolled away. */}
                    <span className="sticky truncate px-2 first-letter:uppercase" style={{ left: LANE_LABEL_PX }}>
                      {monthLabel(m.iso)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Lanes */}
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 z-0" style={{ left: LANE_LABEL_PX, width }}>
                {ticks.map((m) => (
                  <div key={m.iso} className="absolute inset-y-0 border-l border-border/40" style={{ left: m.x }} />
                ))}
                <div aria-hidden className="absolute inset-y-0 w-px bg-destructive/60" style={{ left: xOf(today, range.start, zoom) }}>
                  <span className="absolute -top-px left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-destructive" />
                </div>
                {dropX !== null ? <div className="absolute inset-y-0 w-0.5 bg-foreground/40" style={{ left: dropX - LANE_LABEL_PX }} /> : null}
              </div>
              {lanes.length === 0 ? (
                <div className="flex h-28 items-center pl-6 text-sm text-muted-foreground" style={{ marginLeft: LANE_LABEL_PX }}>
                  {t("nothingDated")}
                </div>
              ) : (
                lanes.map((lane) => <LaneRow key={lane.key} lane={lane} label={lane.category ? name(lane.category) : name(null)} start={range.start} width={width} zoom={zoom} />)
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="px-1 text-xs text-muted-foreground">{t("dragHint")}</p>
    </div>
  );
}

function LaneRow({ lane, label, start, width, zoom }: { lane: Lane; label: string; start: string; width: number; zoom: Zoom }) {
  const items = lane.items.map((m) => ({ id: m.id, x: xOf(m.target_date!, start, zoom), m }));
  const { row, rows } = packRows(items, CARD_PX[zoom]);
  const height = rows * ROW_PX + LANE_PAD * 2;
  return (
    <div className="relative flex border-b last:border-b-0" style={{ height }}>
      <div className="sticky left-0 z-10 flex shrink-0 items-start gap-2 border-r bg-background px-3 pt-4 text-[13px] font-medium" style={{ width: LANE_LABEL_PX }}>
        {lane.category ? <CategoryGlyph icon={lane.category.icon} className="mt-px size-3.5 text-muted-foreground" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="relative" style={{ width }}>
        {items.map((it) => (
          <MilestoneCard key={it.id} milestone={it.m} x={it.x} y={LANE_PAD + (row.get(it.id) ?? 0) * ROW_PX} start={start} zoom={zoom} />
        ))}
      </div>
    </div>
  );
}

/** A milestone on the timeline: click to open, drag sideways to change its date (Alt + arrows too). */
function MilestoneCard({ milestone, x, y, start, zoom }: { milestone: Milestone; x: number; y: number; start: string; zoom: Zoom }) {
  const t = useTranslations("studio.roadmap");
  const index = useIndex();
  const panel = usePanel();
  const actions = useStudioActions();
  const dates = useDates();
  const today = useToday();
  const [drag, setDrag] = React.useState<{ from: number; dx: number; moved: boolean } | null>(null);
  const progress = index.progress.get(milestone.id) ?? { done: 0, total: 0, ratio: null };
  const done = milestone.status === "done";
  const preview = drag?.moved ? dateAt(Math.max(0, x + drag.dx), start, zoom) : milestone.target_date!;
  const late = !done && dueTone(milestone.target_date, today) === "overdue";
  const shift = (days: number) => void actions.updateMilestone(milestone.id, { target_date: addDays(milestone.target_date!, days) });

  return (
    <button
      type="button"
      data-milestone={milestone.id}
      aria-label={t("cardLabel", { title: milestone.title, date: dates.long(milestone.target_date!), done: progress.done, total: progress.total })}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag({ from: e.clientX, dx: 0, moved: false });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const dx = e.clientX - drag.from;
        setDrag({ ...drag, dx, moved: drag.moved || Math.abs(dx) > 4 });
      }}
      onPointerUp={() => {
        const d = drag;
        setDrag(null);
        if (!d) return;
        if (!d.moved) return panel.open("milestone", milestone.id);
        const next = dateAt(Math.max(0, x + d.dx), start, zoom);
        if (next !== milestone.target_date) void actions.updateMilestone(milestone.id, { target_date: next });
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        shift((e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 7 : 1));
      }}
      className={cn(
        "group absolute z-10 flex touch-none select-none flex-col justify-center rounded-lg border bg-card px-3 text-left shadow-sm outline-none transition-[box-shadow,transform] hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
        drag?.moved ? "z-20 cursor-grabbing shadow-lg ring-1 ring-foreground/20" : "cursor-grab",
        done && "bg-muted/40",
      )}
      style={{ left: x, top: y, width: CARD_PX[zoom] - 14, height: ROW_PX - 10, transform: drag?.moved ? `translateX(${drag.dx}px)` : undefined }}
    >
      <span aria-hidden className={cn("absolute -left-[5px] top-1/2 size-2.5 -translate-y-1/2 rotate-45 rounded-[2px] border bg-background", done ? "border-success bg-success" : late ? "border-destructive" : "border-foreground/60")} />
      <span className="flex items-center gap-1.5">
        {done ? <CheckIcon className="size-3.5 shrink-0 text-success" /> : null}
        <span className={cn("truncate text-[13px] font-medium", done && "text-muted-foreground")}>{milestone.title}</span>
      </span>
      <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("shrink-0 tabular-nums", late && "text-destructive", drag?.moved && "font-medium text-foreground")}>{dates.short(preview)}</span>
        {progress.total ? (
          <>
            <ProgressBar ratio={progress.ratio} label={t("progressLabel")} tone={progress.ratio === 1 ? "success" : "default"} className="h-1 min-w-6 flex-1" />
            <span className="shrink-0 tabular-nums">{`${progress.done}/${progress.total}`}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}

function UnscheduledChip({ milestone }: { milestone: Milestone }) {
  const t = useTranslations("studio.roadmap");
  const panel = usePanel();
  const index = useIndex();
  const progress = index.progress.get(milestone.id);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-studio-milestone", milestone.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => panel.open("milestone", milestone.id)}
      aria-label={t("unscheduledLabel", { title: milestone.title })}
      className="inline-flex max-w-72 cursor-grab items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-[13px] shadow-xs outline-none transition-colors hover:bg-accent active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FlagIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{milestone.title}</span>
      {progress?.total ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{`${progress.done}/${progress.total}`}</span> : null}
    </button>
  );
}

// ─── Chronological list ─────────────────────────────────────────────────────

function ChronoList({ milestones, compact = false }: { milestones: Milestone[]; compact?: boolean }) {
  const t = useTranslations("studio.roadmap");
  const tm = useTranslations("studio.milestoneStatus");
  const index = useIndex();
  const panel = usePanel();
  const dates = useDates();
  const today = useToday();
  const name = useCategoryName();
  const sorted = [...milestones].sort((a, b) => (a.target_date && b.target_date ? a.target_date.localeCompare(b.target_date) : a.target_date ? -1 : b.target_date ? 1 : a.sort_order - b.sort_order));
  const groups = new Map<string, Milestone[]>();
  for (const m of sorted) {
    const key = m.target_date ? m.target_date.slice(0, 7) : "later";
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return (
    <div className={cn("space-y-6", compact && "mt-3 opacity-80")}>
      {[...groups.entries()].map(([key, list]) => (
        <section key={key} aria-label={key === "later" ? t("toSchedule") : dates.monthYear(`${key}-01`)}>
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted-foreground first-letter:uppercase">{key === "later" ? t("toSchedule") : dates.monthYear(`${key}-01`)}</h2>
          <ul className="divide-y rounded-xl border bg-card/30">
            {list.map((m) => {
              const p = index.progress.get(m.id) ?? { done: 0, total: 0, ratio: null };
              const c = m.category_id ? index.categories.get(m.category_id) : null;
              const late = m.status !== "done" && m.target_date && diffDays(today, m.target_date) < 0;
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => panel.open("milestone", m.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/50">
                    <span className="flex min-w-0 flex-1 basis-60 items-center gap-2.5">
                      {m.status === "done" ? <CheckIcon className="size-4 shrink-0 text-success" /> : <FlagIcon className="size-4 shrink-0 text-muted-foreground" />}
                      <span className={cn("truncate text-sm font-medium", m.status === "done" && "text-muted-foreground")}>{m.title}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {c ? <CategoryGlyph icon={c.icon} className="size-3.5" /> : null}
                      {name(c)}
                    </span>
                    <span className="w-24 text-xs text-muted-foreground">{tm(m.status)}</span>
                    <span className="flex w-40 items-center gap-2">
                      <ProgressBar ratio={p.ratio ?? 0} label={t("progressLabel")} tone={p.ratio === 1 ? "success" : "default"} className="h-1" />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.total ? `${p.done}/${p.total}` : "—"}</span>
                    </span>
                    <span className={cn("w-20 text-right text-xs tabular-nums text-muted-foreground", late && "text-destructive")}>{m.target_date ? dates.short(m.target_date) : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
