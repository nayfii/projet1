"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import * as server from "../server/actions";
import type { DateChange } from "../logic/planning";
import { COLLECTION, PANEL_KINDS, type Entity, type EntityRow, type PanelKind, type ScaleError, type ScaleResult, type ScaleSnapshot } from "../types";

/**
 * One copy of every Scale record, shared by all views: a change made in the Kanban is the same
 * record the list, the calendar and the overview show. Changes are applied at once on screen, saved
 * on the server, and undone with a message (and "Retry") if the save fails.
 */

type State = ScaleSnapshot;
type SaveState = { pending: number; failed: null | { retry: () => void } };

type Ctx = {
  data: State;
  save: SaveState;
  setData: React.Dispatch<React.SetStateAction<State>>;
  run: <T>(call: () => Promise<ScaleResult<T>>, opts?: { onError?: () => void; quiet?: boolean; retry?: () => void }) => Promise<T | null>;
};

const ScaleContext = React.createContext<Ctx | null>(null);

/** Kept across visits, so coming back to Scale shows the latest data at once. */
let cache: State | null = null;

export function ScaleProvider({ initial, children }: { initial: ScaleSnapshot; children: React.ReactNode }) {
  const t = useTranslations("scale.errors");
  const [data, setData] = React.useState<State>(() => (cache && cache.loadedAt > initial.loadedAt && cache.meId === initial.meId ? cache : initial));
  const [save, setSave] = React.useState<SaveState>({ pending: 0, failed: null });

  React.useEffect(() => {
    cache = data;
  }, [data]);

  const run = React.useCallback(
    async <T,>(call: () => Promise<ScaleResult<T>>, opts: { onError?: () => void; quiet?: boolean; retry?: () => void } = {}): Promise<T | null> => {
      setSave((s) => ({ pending: s.pending + 1, failed: s.failed }));
      let res: ScaleResult<T>;
      try {
        res = await call();
      } catch {
        res = { ok: false, error: "unknown" };
      }
      setSave((s) => ({ pending: Math.max(0, s.pending - 1), failed: res.ok ? (s.pending <= 1 ? null : s.failed) : opts.retry ? { retry: opts.retry } : s.failed }));
      if (res.ok) return res.data;
      opts.onError?.();
      if (!opts.quiet) {
        const message = t(res.error as ScaleError);
        toast.error(message, opts.retry ? { action: { label: t("retry"), onClick: opts.retry } } : undefined);
      }
      return null;
    },
    [t],
  );

  // Fresh data when coming back to the tab (another member of our team may have changed something).
  React.useEffect(() => {
    let last = Date.now();
    const refresh = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      const res = await server.refreshScale().catch(() => null);
      if (res?.ok) setData({ ...res.data, loadedAt: Date.now() });
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const value = React.useMemo(() => ({ data, save, setData, run }), [data, save, run]);
  return <ScaleContext.Provider value={value}>{children}</ScaleContext.Provider>;
}

function useCtx(): Ctx {
  const ctx = React.useContext(ScaleContext);
  if (!ctx) throw new Error("Scale store missing");
  return ctx;
}

export function useScale(): State {
  return useCtx().data;
}

export function useSaveState(): SaveState {
  return useCtx().save;
}

type AnyRow = { id: string } & Record<string, unknown>;

function upsertRows<S extends State>(state: S, entity: Entity, rows: AnyRow[]): S {
  const key = COLLECTION[entity];
  const list = state[key] as unknown as AnyRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const merged = list.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id)! } : r));
  const added = rows.filter((r) => !list.some((x) => x.id === r.id));
  return { ...state, [key]: [...merged, ...added] };
}

function removeRow<S extends State>(state: S, entity: Entity, id: string): S {
  const key = COLLECTION[entity];
  return { ...state, [key]: (state[key] as unknown as AnyRow[]).filter((r) => r.id !== id) };
}

/** Everything a view can change. Each call updates the screen first, then saves. */
export function useScaleActions() {
  const { data, setData, run } = useCtx();
  const t = useTranslations("scale");
  const dataRef = React.useRef(data);
  dataRef.current = data;

  return React.useMemo(() => {
    const find = (entity: Entity, id: string) => (dataRef.current[COLLECTION[entity]] as unknown as AnyRow[]).find((r) => r.id === id);

    async function create<E extends Entity>(entity: E, values: Record<string, unknown>): Promise<EntityRow[E] | null> {
      const row = await run(() => server.createRecord(entity, values));
      if (row) setData((s) => upsertRows(s, entity, [row as AnyRow]));
      return row as unknown as EntityRow[E] | null;
    }

    async function update(entity: Entity, id: string, patch: Record<string, unknown>, opts: { expectedUpdatedAt?: string; quiet?: boolean } = {}): Promise<boolean> {
      const before = find(entity, id);
      if (before) setData((s) => upsertRows(s, entity, [{ ...before, ...patch, id }]));
      const res = await run(() => server.updateRecord(entity, id, patch, opts.expectedUpdatedAt), {
        quiet: opts.quiet,
        onError: () => before && setData((s) => upsertRows(s, entity, [before])),
        retry: () => void update(entity, id, patch),
      });
      if (!res) return false;
      setData((s) => {
        let next = upsertRows(s, entity, [res.row as AnyRow]);
        if (res.created) next = upsertRows(next, entity, [res.created as AnyRow]);
        // Only one main objective at a time.
        if (entity === "objective" && patch.is_focus === true) next = { ...next, objectives: next.objectives.map((o) => (o.id === id ? o : { ...o, is_focus: false })) };
        return next;
      });
      if (res.created) toast.success(t("toast.nextOccurrence"));
      return true;
    }

    async function archive(entity: Entity, id: string, archived: boolean): Promise<boolean> {
      const before = find(entity, id);
      if (before) setData((s) => upsertRows(s, entity, [{ ...before, archived_at: archived ? new Date().toISOString() : null }]));
      const row = await run(() => server.archiveRecord(entity, id, archived), { onError: () => before && setData((s) => upsertRows(s, entity, [before])) });
      if (!row) return false;
      setData((s) => upsertRows(s, entity, [row as AnyRow]));
      toast.success(archived ? t("toast.archived") : t("toast.restored"), archived ? { action: { label: t("toast.undo"), onClick: () => void archive(entity, id, false) } } : undefined);
      return true;
    }

    async function remove(entity: Entity, id: string): Promise<boolean> {
      const res = await run(() => server.deleteRecord(entity, id));
      if (!res) return false;
      setData((s) => {
        let next = removeRow(s, entity, id);
        if (entity === "task") next = { ...next, taskDeps: next.taskDeps.filter((d) => d.task_id !== id && d.depends_on_id !== id), links: next.links.filter((l) => !(l.entity_type === "task" && l.entity_id === id)) };
        if (entity === "project") next = { ...next, projectDeps: next.projectDeps.filter((d) => d.project_id !== id && d.depends_on_id !== id), milestones: next.milestones.filter((m) => m.project_id !== id) };
        if (entity === "test") next = { ...next, comparisons: next.comparisons.filter((c) => c.test_id !== id), observations: next.observations.filter((o) => o.test_id !== id) };
        if (entity === "metric") next = { ...next, measurements: next.measurements.filter((m) => m.metric_id !== id) };
        return next;
      });
      return true;
    }

    async function duplicate(entity: Entity, id: string): Promise<string | null> {
      const res = await run(() => server.duplicateRecord(entity, id, t("copySuffix")));
      if (!res) return null;
      setData((s) => res.rows.reduce((acc, r) => upsertRows(acc, r.entity, [r.row as AnyRow]), s));
      toast.success(t("toast.duplicated"));
      return res.rows[0]?.row.id ?? null;
    }

    async function bulkUpdate(ids: string[], patch: Record<string, unknown>): Promise<boolean> {
      const before = ids.map((id) => find("task", id)).filter((r): r is AnyRow => Boolean(r));
      setData((s) => upsertRows(s, "task", before.map((r) => ({ ...r, ...patch }))));
      const rows = await run(() => server.bulkUpdateTasks(ids, patch), { onError: () => setData((s) => upsertRows(s, "task", before)) });
      if (!rows) return false;
      setData((s) => upsertRows(s, "task", rows as AnyRow[]));
      return true;
    }

    async function bulkArchive(ids: string[], archived: boolean): Promise<boolean> {
      const rows = await run(() => server.bulkArchiveTasks(ids, archived));
      if (!rows) return false;
      setData((s) => upsertRows(s, "task", rows as AnyRow[]));
      toast.success(archived ? t("toast.archivedMany", { count: rows.length }) : t("toast.restored"), archived ? { action: { label: t("toast.undo"), onClick: () => void bulkArchive(ids, false) } } : undefined);
      return true;
    }

    async function setDependency(kind: "task" | "project", id: string, dependsOn: string, on: boolean): Promise<boolean> {
      const res = await run(() => server.setDependency(kind, id, dependsOn, on));
      if (!res) return false;
      setData((s) => {
        if (kind === "task") {
          const rest = s.taskDeps.filter((d) => !(d.task_id === id && d.depends_on_id === dependsOn));
          return { ...s, taskDeps: on ? [...rest, { task_id: id, depends_on_id: dependsOn, created_at: new Date().toISOString() }] : rest };
        }
        const rest = s.projectDeps.filter((d) => !(d.project_id === id && d.depends_on_id === dependsOn));
        return { ...s, projectDeps: on ? [...rest, { project_id: id, depends_on_id: dependsOn, created_at: new Date().toISOString() }] : rest };
      });
      return true;
    }

    async function applyDates(kind: "task" | "project" | "milestone", changes: DateChange[]): Promise<boolean> {
      const rows = await run(() => server.applyDateChanges(kind, changes.map((c) => ({ id: c.id, start: c.to.start, end: c.to.end }))));
      if (!rows) return false;
      setData((s) => upsertRows(s, kind, rows as AnyRow[]));
      toast.success(changes.length > 1 ? t("toast.rescheduledMany", { count: changes.length }) : t("toast.rescheduled"));
      return true;
    }

    async function linkCompany(entityType: "project" | "task" | "test" | "decision", entityId: string, companyId: string, role: string, note: string | null) {
      const row = await run(() => server.linkCompany(entityType, entityId, companyId, role, note));
      if (row) setData((s) => ({ ...s, links: [...s.links.filter((l) => l.id !== row.id && !(l.company_id === companyId && l.entity_type === entityType && l.entity_id === entityId)), row as unknown as State["links"][number]] }));
      return Boolean(row);
    }

    async function unlinkCompany(linkId: string) {
      const res = await run(() => server.unlinkCompany(linkId));
      if (res) setData((s) => ({ ...s, links: s.links.filter((l) => l.id !== linkId) }));
      return Boolean(res);
    }

    async function saveWeek(monday: string, values: Record<string, unknown>) {
      const row = await run(() => server.saveWeek(monday, values), { retry: () => void saveWeek(monday, values) });
      if (row) setData((s) => ({ ...s, weeks: [...s.weeks.filter((w) => w.week_start !== monday), row] }));
      return Boolean(row);
    }

    async function saveReview(monday: string, values: Record<string, unknown>, complete: boolean) {
      const row = await run(() => server.saveReview(monday, values, complete), { retry: () => void saveReview(monday, values, complete) });
      if (row) setData((s) => ({ ...s, reviews: [row, ...s.reviews.filter((r) => r.week_start !== monday)] }));
      return Boolean(row);
    }

    async function resolveCarryOver(choices: { id: string; action: "next_week" | "later" | "drop" }[], nextMonday: string) {
      const rows = await run(() => server.resolveCarryOver(choices, nextMonday));
      if (rows) setData((s) => upsertRows(s, "task", rows as AnyRow[]));
      return Boolean(rows);
    }

    async function saveSettings(values: Record<string, unknown>) {
      const row = await run(() => server.saveSettings(values), { retry: () => void saveSettings(values) });
      if (row) setData((s) => ({ ...s, settings: row }));
      return Boolean(row);
    }

    async function replaceAll(call: () => Promise<ScaleResult<ScaleSnapshot>>) {
      const snap = await run(call);
      if (snap) setData({ ...snap, loadedAt: Date.now() });
      return Boolean(snap);
    }

    async function addSuggestedMetrics() {
      const rows = await run(() => server.addSuggestedMetrics());
      if (rows) setData((s) => upsertRows(s, "metric", rows as AnyRow[]));
      return Boolean(rows);
    }

    async function createTestFromTemplate(key: string, projectId: string | null) {
      const row = await run(() => server.createTestFromTemplate(key, projectId));
      if (row) setData((s) => upsertRows(s, "test", [row as AnyRow]));
      return row as unknown as EntityRow["test"] | null;
    }

    async function saveView(values: { section: string; name: string; config: Record<string, unknown> }) {
      const row = await run(() => server.saveView(values));
      if (row) setData((s) => ({ ...s, views: [...s.views, row as unknown as State["views"][number]] }));
      return Boolean(row);
    }

    async function deleteView(id: string) {
      const res = await run(() => server.deleteView(id));
      if (res) setData((s) => ({ ...s, views: s.views.filter((v) => v.id !== id) }));
    }

    async function refresh() {
      await replaceAll(() => server.refreshScale());
    }

    /** A row saved by a dedicated action (the document editor): shown everywhere at once. */
    function local(entity: Entity, row: AnyRow) {
      setData((s) => upsertRows(s, entity, [row]));
    }

    return {
      create,
      update,
      archive,
      remove,
      duplicate,
      bulkUpdate,
      bulkArchive,
      setDependency,
      applyDates,
      linkCompany,
      unlinkCompany,
      saveWeek,
      saveReview,
      resolveCarryOver,
      saveSettings,
      start: (mode: "empty" | "cendr", values: Record<string, unknown>) => replaceAll(() => server.startScale(mode, values)),
      addStarter: () => replaceAll(() => server.addCendrStarter()),
      addSuggestedMetrics,
      createTestFromTemplate,
      saveView,
      deleteView,
      refresh,
      local,
      run,
    };
  }, [run, setData, t]);
}

export type ScaleActions = ReturnType<typeof useScaleActions>;

// ─── Side panel (`?open=task:<id>`), kept in the address so links open it directly ───

export function usePanel() {
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("open");
  const [kind, id] = raw?.split(":") ?? [];
  const current = kind && id && (PANEL_KINDS as readonly string[]).includes(kind) ? { kind: kind as PanelKind, id } : null;
  const full = params.get("full") === "1";

  // Only the address changes (no server round trip): the panel opens and closes at once, and the
  // page underneath keeps its position and filters. Back and forward work as usual.
  const go = React.useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      window.history.pushState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const open = React.useCallback(
    (k: PanelKind, itemId: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("open", `${k}:${itemId}`);
      go(next);
    },
    [params, go],
  );

  const close = React.useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("open");
    next.delete("full");
    go(next);
  }, [params, go]);

  const toggleFull = React.useCallback(() => {
    const next = new URLSearchParams(params.toString());
    if (full) next.delete("full");
    else next.set("full", "1");
    go(next);
  }, [params, go, full]);

  return { current, full, open, close, toggleFull };
}

// ─── Small per-person preferences (last view, filters): this browser only ───

export function usePref<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const storageKey = `cendr-scale:${key}`;
  const [value, setValue] = React.useState<T>(initial);
  const loaded = React.useRef(false);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration (the server cannot know it)
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Not available: the default stays.
    }
    loaded.current = true;
  }, [storageKey]);
  const set = React.useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Not kept: fine.
        }
        return next;
      });
    },
    [storageKey],
  );
  return [value, set];
}
