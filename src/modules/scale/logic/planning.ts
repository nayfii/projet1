import { addDays, diffDays, inWeek, addMonths } from "./dates";
import type { Milestone, Objective, Project, Task } from "../types";

/** "a depends on b": a cannot start before b is finished. */
export type Edge = { from: string; to: string };

const CLOSED_TASK = new Set(["done", "cancelled"]);

export function isClosedTask(task: Pick<Task, "status">): boolean {
  return CLOSED_TASK.has(task.status);
}

/** Whether adding "from depends on to" would close a loop (to already depends, directly or not, on from). */
export function wouldCreateCycle(edges: Edge[], from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/** Ids caught in a loop of dependencies (should never happen: shown if older data holds one). */
export function itemsInCycles(edges: Edge[]): Set<string> {
  const ids = new Set(edges.flatMap((e) => [e.from, e.to]));
  const result = new Set<string>();
  for (const id of ids) {
    const others = edges.filter((e) => e.from === id);
    if (others.some((e) => wouldCreateCycle(edges.filter((x) => x !== e), e.from, e.to))) result.add(id);
  }
  return result;
}

/** The unfinished tasks a task waits for. */
export function openBlockers(taskId: string, edges: Edge[], tasks: Map<string, Task>): Task[] {
  return edges
    .filter((e) => e.from === taskId)
    .map((e) => tasks.get(e.to))
    .filter((t): t is Task => Boolean(t) && !t!.archived_at && !isClosedTask(t!));
}

export type Span = { id: string; start: string | null; end: string | null };

function spanStart(s: Span): string | null {
  return s.start ?? s.end;
}
function spanEnd(s: Span): string | null {
  return s.end ?? s.start;
}

/** Items planned to start before what they depend on is due to end. */
export function dateConflicts(spans: Span[], edges: Edge[]): { id: string; dependsOn: string; days: number }[] {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const out: { id: string; dependsOn: string; days: number }[] = [];
  for (const e of edges) {
    const item = byId.get(e.from);
    const before = byId.get(e.to);
    if (!item || !before) continue;
    const start = spanStart(item);
    const end = spanEnd(before);
    if (start && end && start < end) out.push({ id: e.from, dependsOn: e.to, days: diffDays(start, end) });
  }
  return out;
}

export type DateChange = { id: string; from: { start: string | null; end: string | null }; to: { start: string | null; end: string | null }; because: string | null };

/**
 * Moving one item: the change itself, then each item that depends on it (directly or not) and would
 * otherwise start before its predecessor ends, moved by just enough days. Nothing is applied here: the
 * list is shown first, then applied with or without the cascade.
 */
export function cascadePlan(spans: Span[], edges: Edge[], movedId: string, to: { start: string | null; end: string | null }): DateChange[] {
  const byId = new Map(spans.map((s) => [s.id, { ...s }]));
  const moved = byId.get(movedId);
  if (!moved) return [];
  const changes = new Map<string, DateChange>();
  changes.set(movedId, { id: movedId, from: { start: moved.start, end: moved.end }, to, because: null });
  byId.set(movedId, { id: movedId, ...to });

  const queue = [movedId];
  let guard = 0;
  while (queue.length && guard++ < 10_000) {
    const id = queue.shift()!;
    const pred = byId.get(id)!;
    const predEnd = spanEnd(pred);
    if (!predEnd) continue;
    for (const e of edges.filter((x) => x.to === id)) {
      const dep = byId.get(e.from);
      if (!dep || e.from === movedId) continue;
      const start = spanStart(dep);
      if (!start || start >= predEnd) continue;
      const shift = diffDays(start, predEnd);
      const next = { start: dep.start ? addDays(dep.start, shift) : null, end: dep.end ? addDays(dep.end, shift) : null };
      const original = changes.get(e.from)?.from ?? { start: dep.start, end: dep.end };
      changes.set(e.from, { id: e.from, from: original, to: next, because: id });
      byId.set(e.from, { id: e.from, ...next });
      queue.push(e.from);
    }
  }
  return [...changes.values()];
}

// ─── Progress, attainment and health (three different things) ─────────────

export type Progress = { done: number; total: number; ratio: number | null };

/** Share of the work done: top-level tasks, cancelled ones left out. Says nothing about the result. */
export function taskProgress(tasks: Task[]): Progress {
  const counted = tasks.filter((t) => !t.archived_at && !t.parent_id && t.status !== "cancelled");
  const done = counted.filter((t) => t.status === "done").length;
  return { done, total: counted.length, ratio: counted.length ? done / counted.length : null };
}

/**
 * How far the expected result is reached: a numeric objective from its values (null when one is
 * missing), a validation objective only from its explicit state. Finishing tasks never changes it.
 */
export function objectiveAttainment(o: Pick<Objective, "kind" | "baseline" | "current_value" | "target" | "validation_state">): number | null {
  if (o.kind === "validation") return o.validation_state === "validated" ? 1 : o.validation_state === "not_validated" ? 0 : null;
  if (o.target === null || o.current_value === null) return null;
  const base = o.baseline ?? 0;
  if (o.target === base) return o.current_value >= o.target ? 1 : 0;
  return Math.max(0, Math.min(1, (o.current_value - base) / (o.target - base)));
}

export type HealthHint = "milestone_overdue" | "target_passed" | "tasks_blocked" | "tasks_overdue";

/** Signals that may justify "at risk" or "blocked". The health itself stays a person's call. */
export function healthHints(project: Project, milestones: Milestone[], tasks: Task[], today: string): HealthHint[] {
  const hints: HealthHint[] = [];
  const open = project.status !== "done" && project.status !== "cancelled";
  if (!open) return hints;
  if (milestones.some((m) => !m.archived_at && !m.achieved_date && m.target_date && m.target_date < today)) hints.push("milestone_overdue");
  if (project.target_date && project.target_date < today && !project.achieved_date) hints.push("target_passed");
  const live = tasks.filter((t) => !t.archived_at && !isClosedTask(t));
  if (live.some((t) => t.status === "blocked")) hints.push("tasks_blocked");
  if (live.some((t) => t.due_date && t.due_date < today)) hints.push("tasks_overdue");
  return hints;
}

// ─── The week: capacity versus estimated effort ─────────────────────────────

/** Tasks of a week: planned for it, or due in it without being planned for another week. */
export function tasksOfWeek(tasks: Task[], monday: string): Task[] {
  return tasks.filter((t) => !t.archived_at && t.status !== "cancelled" && (t.week_start === monday || (!t.week_start && inWeek(t.due_date, monday))));
}

export type WeekLoad = { planned: number; estimated: number; unestimated: number; doneHours: number; capacity: number | null; over: number | null };

/** Estimated hours are estimates: compared with the capacity typed in, never spread over the calendar. */
export function weekLoad(tasks: Task[], monday: string, capacity: number | null): WeekLoad {
  const week = tasksOfWeek(tasks, monday);
  const estimated = week.filter((t) => t.estimate_hours !== null);
  const planned = estimated.reduce((sum, t) => sum + Number(t.estimate_hours), 0);
  const doneHours = estimated.filter((t) => t.status === "done").reduce((sum, t) => sum + Number(t.estimate_hours), 0);
  return {
    planned: round1(planned),
    estimated: estimated.length,
    unestimated: week.length - estimated.length,
    doneHours: round1(doneHours),
    capacity,
    over: capacity === null ? null : round1(Math.max(0, planned - capacity)),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Next date of a recurring task (reviews and routines). */
export function nextOccurrence(date: string, recurrence: string): string {
  if (recurrence === "weekly") return addDays(date, 7);
  if (recurrence === "biweekly") return addDays(date, 14);
  return addMonths(date, 1);
}

// ─── Product items: an optional, transparent score ──────────────────────────

/** Impact × confidence ÷ effort (each from 1 to 5). Null until all three are filled in. */
export function priorityScore(t: Pick<Task, "impact" | "confidence" | "effort">): number | null {
  if (!t.impact || !t.confidence || !t.effort) return null;
  return Math.round(((t.impact * t.confidence) / t.effort) * 10) / 10;
}

// ─── Economic simulation ────────────────────────────────────────────────────

export type SimulationInputs = {
  pricePerUser: number | null;
  usersPerCustomer: number | null;
  customers: number | null;
  variableCostPerUser: number | null;
  fixedCosts: number | null;
};

export type SimulationResult = {
  users: number | null;
  revenue: number | null;
  variableCosts: number | null;
  contribution: number | null;
  margin: number | null;
  marginRate: number | null;
  breakEvenCustomers: number | null;
};

/** Monthly figures from the hypotheses typed in; each result is null when an input it needs is missing. */
export function simulate(i: SimulationInputs): SimulationResult {
  const has = (...v: (number | null)[]) => v.every((x) => x !== null && Number.isFinite(x));
  const users = has(i.usersPerCustomer, i.customers) ? i.usersPerCustomer! * i.customers! : null;
  const revenue = users !== null && has(i.pricePerUser) ? users * i.pricePerUser! : null;
  const variableCosts = users !== null && has(i.variableCostPerUser) ? users * i.variableCostPerUser! : null;
  const contribution = revenue !== null && variableCosts !== null ? revenue - variableCosts : null;
  const margin = contribution !== null && has(i.fixedCosts) ? contribution - i.fixedCosts! : null;
  const marginRate = margin !== null && revenue ? margin / revenue : null;
  const perCustomer = has(i.pricePerUser, i.variableCostPerUser, i.usersPerCustomer) ? (i.pricePerUser! - i.variableCostPerUser!) * i.usersPerCustomer! : null;
  const breakEvenCustomers = perCustomer !== null && perCustomer > 0 && has(i.fixedCosts) ? Math.ceil(i.fixedCosts! / perCustomer) : null;
  return { users, revenue, variableCosts, contribution, margin, marginRate, breakEvenCustomers };
}
