"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import * as server from "../server/actions";
import type { Category, DocumentMeta, Milestone, PanelKind, StudioError, StudioResult, StudioSnapshot, Task } from "../types";
import { PANEL_KINDS } from "../types";

/**
 * One copy of every Studio record, shared by all sections: the task finished on the Overview is the
 * same record Tasks, the Roadmap's progress and the counts read. Changes show at once, are saved on
 * the server, and are undone with a message (and "Retry") if the save fails.
 */

type State = StudioSnapshot;
type SaveState = { pending: number; failed: null | { retry: () => void } };
type RunOptions = { onError?: () => void; quiet?: boolean; retry?: () => void };

type Ctx = {
  data: State;
  save: SaveState;
  setData: React.Dispatch<React.SetStateAction<State>>;
  run: <T>(call: () => Promise<StudioResult<T>>, opts?: RunOptions) => Promise<T | null>;
};

const StudioContext = React.createContext<Ctx | null>(null);

/** Kept across visits, so coming back to Studio shows the latest data at once. */
let cache: State | null = null;

export function StudioProvider({ initial, children }: { initial: StudioSnapshot; children: React.ReactNode }) {
  const t = useTranslations("studio.errors");
  const [data, setData] = React.useState<State>(() => (cache && cache.loadedAt > initial.loadedAt && cache.me.id === initial.me.id ? cache : initial));
  const [save, setSave] = React.useState<SaveState>({ pending: 0, failed: null });

  React.useEffect(() => {
    cache = data;
  }, [data]);

  const run = React.useCallback(
    async <T,>(call: () => Promise<StudioResult<T>>, opts: RunOptions = {}): Promise<T | null> => {
      setSave((s) => ({ pending: s.pending + 1, failed: s.failed }));
      let res: StudioResult<T>;
      try {
        res = await call();
      } catch {
        res = { ok: false, error: "unknown" };
      }
      setSave((s) => ({ pending: Math.max(0, s.pending - 1), failed: res.ok ? (s.pending <= 1 ? null : s.failed) : opts.retry ? { retry: opts.retry } : s.failed }));
      if (res.ok) return res.data;
      opts.onError?.();
      if (!opts.quiet) toast.error(t(res.error as StudioError), opts.retry ? { action: { label: t("retry"), onClick: opts.retry } } : undefined);
      return null;
    },
    [t],
  );

  // Fresh data when coming back to the tab (someone else in our team may have changed something).
  React.useEffect(() => {
    let last = Date.now();
    const refresh = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      const res = await server.refreshStudio().catch(() => null);
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
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

function useCtx(): Ctx {
  const ctx = React.useContext(StudioContext);
  if (!ctx) throw new Error("Studio store missing");
  return ctx;
}

export function useStudio(): State {
  return useCtx().data;
}

export function useSaveState(): SaveState {
  return useCtx().save;
}

type Keyed = { id: string };
function upsert<T extends Keyed>(list: T[], rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const merged = list.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id)! } : r));
  return [...merged, ...rows.filter((r) => !list.some((x) => x.id === r.id))];
}

/** Everything a section can change. Each call updates the screen first, then saves. */
export function useStudioActions() {
  const { data, setData, run } = useCtx();
  const t = useTranslations("studio.toast");
  const dataRef = React.useRef(data);
  React.useEffect(() => {
    dataRef.current = data;
  }, [data]);

  return React.useMemo(() => {
    const now = () => new Date().toISOString();

    // ─── Tasks ───
    async function createTask(values: Partial<Task> & { title: string }): Promise<Task | null> {
      const tempId = `tmp-${crypto.randomUUID()}`;
      const temp: Task = {
        id: tempId,
        title: values.title,
        description: values.description ?? null,
        status: values.status ?? "todo",
        priority: values.priority ?? "medium",
        due_date: values.due_date ?? null,
        category_id: values.category_id ?? null,
        milestone_id: values.milestone_id ?? null,
        sort_order: values.sort_order ?? Math.max(0, ...dataRef.current.tasks.map((x) => x.sort_order)) + 1,
        completed_at: values.status === "done" ? now() : null,
        created_at: now(),
        updated_at: now(),
        archived_at: null,
      };
      setData((s) => ({ ...s, tasks: [...s.tasks, temp] }));
      const { id: _id, completed_at: _c, created_at: _ca, updated_at: _u, archived_at: _a, ...insert } = temp;
      void [_id, _c, _ca, _u, _a];
      const row = await run(() => server.createTask(insert), { onError: () => setData((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== tempId) })) });
      if (row) setData((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === tempId ? row : x)) }));
      return row;
    }

    async function updateTask(taskId: string, patch: Partial<Task>, opts: { quiet?: boolean } = {}): Promise<boolean> {
      const before = dataRef.current.tasks.find((x) => x.id === taskId);
      if (!before || taskId.startsWith("tmp-")) return false;
      const optimistic: Partial<Task> = { ...patch };
      if (patch.status) optimistic.completed_at = patch.status === "done" ? now() : null;
      setData((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === taskId ? { ...x, ...optimistic } : x)) }));
      const row = await run(() => server.updateTask(taskId, patch), {
        quiet: opts.quiet,
        onError: () => setData((s) => ({ ...s, tasks: upsert(s.tasks, [before]) })),
        retry: () => void updateTask(taskId, patch),
      });
      if (row) setData((s) => ({ ...s, tasks: upsert(s.tasks, [row]) }));
      return Boolean(row);
    }

    /** Done (or back to do), with a way to take it back. */
    async function setDone(taskId: string, done: boolean): Promise<boolean> {
      const before = dataRef.current.tasks.find((x) => x.id === taskId);
      const ok = await updateTask(taskId, { status: done ? "done" : "todo" });
      if (ok && done && before) toast.success(t("taskDone"), { action: { label: t("undo"), onClick: () => void updateTask(taskId, { status: before.status === "done" ? "todo" : before.status }) } });
      return ok;
    }

    async function deleteTask(taskId: string): Promise<boolean> {
      const before = dataRef.current.tasks.find((x) => x.id === taskId);
      setData((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== taskId), taskDocuments: s.taskDocuments.filter((l) => l.task_id !== taskId) }));
      const res = await run(() => server.deleteTask(taskId), { onError: () => before && setData((s) => ({ ...s, tasks: upsert(s.tasks, [before]) })) });
      if (res !== null) toast.success(t("taskDeleted"));
      return res !== null;
    }

    // ─── Milestones ───
    async function createMilestone(values: Partial<Milestone> & { title: string }): Promise<Milestone | null> {
      const row = await run(() => server.createMilestone({ ...values, sort_order: values.sort_order ?? Math.max(0, ...dataRef.current.milestones.map((m) => m.sort_order)) + 1 }));
      if (row) setData((s) => ({ ...s, milestones: [...s.milestones, row] }));
      return row;
    }

    async function updateMilestone(milestoneId: string, patch: Partial<Milestone>): Promise<boolean> {
      const before = dataRef.current.milestones.find((m) => m.id === milestoneId);
      if (!before) return false;
      setData((s) => ({ ...s, milestones: s.milestones.map((m) => (m.id === milestoneId ? { ...m, ...patch } : m)) }));
      const row = await run(() => server.updateMilestone(milestoneId, patch), {
        onError: () => setData((s) => ({ ...s, milestones: upsert(s.milestones, [before]) })),
        retry: () => void updateMilestone(milestoneId, patch),
      });
      if (row) setData((s) => ({ ...s, milestones: upsert(s.milestones, [row]) }));
      return Boolean(row);
    }

    async function archiveMilestone(milestoneId: string, archived: boolean): Promise<boolean> {
      const row = await run(() => server.archiveMilestone(milestoneId, archived));
      if (!row) return false;
      setData((s) => ({ ...s, milestones: upsert(s.milestones, [row]) }));
      toast.success(archived ? t("archived") : t("restored"), archived ? { action: { label: t("undo"), onClick: () => void archiveMilestone(milestoneId, false) } } : undefined);
      return true;
    }

    async function deleteMilestone(milestoneId: string): Promise<boolean> {
      const res = await run(() => server.deleteMilestone(milestoneId));
      if (res === null) return false;
      setData((s) => ({
        ...s,
        milestones: s.milestones.filter((m) => m.id !== milestoneId),
        milestoneDocuments: s.milestoneDocuments.filter((l) => l.milestone_id !== milestoneId),
        tasks: s.tasks.map((x) => (x.milestone_id === milestoneId ? { ...x, milestone_id: null } : x)),
      }));
      toast.success(t("milestoneDeleted"));
      return true;
    }

    // ─── Categories ───
    async function createCategory(values: { name: string; icon?: string }): Promise<Category | null> {
      const row = await run(() => server.createCategory({ ...values, sort_order: Math.max(0, ...dataRef.current.categories.map((c) => c.sort_order)) + 1 }));
      if (row) setData((s) => ({ ...s, categories: [...s.categories, row] }));
      return row;
    }

    async function updateCategory(categoryId: string, patch: Partial<Pick<Category, "name" | "icon" | "sort_order">>): Promise<boolean> {
      const before = dataRef.current.categories.find((c) => c.id === categoryId);
      if (!before) return false;
      setData((s) => ({ ...s, categories: s.categories.map((c) => (c.id === categoryId ? { ...c, ...patch } : c)) }));
      const row = await run(() => server.updateCategory(categoryId, patch), { onError: () => setData((s) => ({ ...s, categories: upsert(s.categories, [before]) })) });
      if (row) setData((s) => ({ ...s, categories: upsert(s.categories, [row]) }));
      return Boolean(row);
    }

    async function deleteCategory(categoryId: string): Promise<boolean> {
      const res = await run(() => server.deleteCategory(categoryId));
      if (res === null) return false;
      const clear = <T extends { category_id: string | null }>(list: T[]) => list.map((x) => (x.category_id === categoryId ? { ...x, category_id: null } : x));
      setData((s) => ({ ...s, categories: s.categories.filter((c) => c.id !== categoryId), documents: clear(s.documents), tasks: clear(s.tasks), milestones: clear(s.milestones) }));
      toast.success(t("categoryDeleted"));
      return true;
    }

    // ─── Documents ───
    async function createDocument(values: { title: string; category_id?: string | null }): Promise<DocumentMeta | null> {
      const row = await run(() => server.createDocument(values));
      if (row) setData((s) => ({ ...s, documents: [row, ...s.documents] }));
      return row;
    }

    async function updateDocument(documentId: string, patch: Partial<Pick<DocumentMeta, "title" | "category_id" | "tags" | "is_pinned">> & { archived?: boolean }): Promise<boolean> {
      const before = dataRef.current.documents.find((d) => d.id === documentId);
      if (!before) return false;
      const { archived, ...rest } = patch;
      const optimistic: Partial<DocumentMeta> = { ...rest };
      if (archived !== undefined) optimistic.archived_at = archived ? now() : null;
      setData((s) => ({ ...s, documents: s.documents.map((d) => (d.id === documentId ? { ...d, ...optimistic } : d)) }));
      const row = await run(() => server.updateDocument(documentId, patch), { onError: () => setData((s) => ({ ...s, documents: upsert(s.documents, [before]) })) });
      if (row) setData((s) => ({ ...s, documents: upsert(s.documents, [row]) }));
      if (row && archived !== undefined) toast.success(archived ? t("archived") : t("restored"), archived ? { action: { label: t("undo"), onClick: () => void updateDocument(documentId, { archived: false }) } } : undefined);
      return Boolean(row);
    }

    async function duplicateDocument(documentId: string, suffix: string): Promise<DocumentMeta | null> {
      const row = await run(() => server.duplicateDocument(documentId, suffix));
      if (row) {
        setData((s) => ({ ...s, documents: [row, ...s.documents] }));
        toast.success(t("duplicated"));
      }
      return row;
    }

    async function deleteDocument(documentId: string): Promise<boolean> {
      const res = await run(() => server.deleteDocument(documentId));
      if (res === null) return false;
      setData((s) => ({
        ...s,
        documents: s.documents.filter((d) => d.id !== documentId),
        taskDocuments: s.taskDocuments.filter((l) => l.document_id !== documentId),
        milestoneDocuments: s.milestoneDocuments.filter((l) => l.document_id !== documentId),
        visits: s.visits.filter((v) => v.document_id !== documentId),
      }));
      toast.success(t("documentDeleted"));
      return true;
    }

    /** A document saved by the editor, or just opened: shown everywhere at once. */
    function localDocument(row: DocumentMeta, opened = false) {
      setData((s) => ({
        ...s,
        documents: upsert(s.documents, [row]),
        visits: opened ? [{ document_id: row.id, opened_at: now() }, ...s.visits.filter((v) => v.document_id !== row.id)] : s.visits,
      }));
    }

    // ─── Links ───
    async function linkDocument(kind: "task" | "milestone", ownerId: string, documentId: string, on: boolean): Promise<boolean> {
      const apply = (add: boolean) =>
        setData((s) =>
          kind === "task"
            ? { ...s, taskDocuments: add ? [...s.taskDocuments.filter((l) => !(l.task_id === ownerId && l.document_id === documentId)), { task_id: ownerId, document_id: documentId }] : s.taskDocuments.filter((l) => !(l.task_id === ownerId && l.document_id === documentId)) }
            : { ...s, milestoneDocuments: add ? [...s.milestoneDocuments.filter((l) => !(l.milestone_id === ownerId && l.document_id === documentId)), { milestone_id: ownerId, document_id: documentId }] : s.milestoneDocuments.filter((l) => !(l.milestone_id === ownerId && l.document_id === documentId)) },
        );
      apply(on);
      const res = await run(() => server.linkDocument(kind, ownerId, documentId, on), { onError: () => apply(!on) });
      return res !== null;
    }

    return {
      createTask,
      updateTask,
      setDone,
      deleteTask,
      createMilestone,
      updateMilestone,
      archiveMilestone,
      deleteMilestone,
      createCategory,
      updateCategory,
      deleteCategory,
      createDocument,
      updateDocument,
      duplicateDocument,
      deleteDocument,
      localDocument,
      linkDocument,
      run,
    };
  }, [run, setData, t]);
}

export type StudioActions = ReturnType<typeof useStudioActions>;

// ─── Side panel (`?open=task:<id>`), kept in the address so links open it directly ───

export function usePanel() {
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("open");
  const [kind, itemId] = raw?.split(":") ?? [];
  const current = kind && itemId && (PANEL_KINDS as readonly string[]).includes(kind) ? { kind: kind as PanelKind, id: itemId } : null;

  // Only the address changes (no server round trip): the panel opens at once and the page underneath
  // keeps its scroll and filters. Back and forward work as usual.
  const go = React.useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      window.history.pushState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const open = React.useCallback(
    (k: PanelKind, id: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("open", `${k}:${id}`);
      go(next);
    },
    [params, go],
  );

  const close = React.useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("open");
    go(next);
  }, [params, go]);

  return { current, open, close };
}

// ─── Small per-person preferences (view, filters, zoom): this browser only ───

export function usePref<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const storageKey = `cendr-studio:${key}`;
  const [value, setValue] = React.useState<T>(initial);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration (the server cannot know it)
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Not available: the default stays.
    }
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
