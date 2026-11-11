import { addDays, diffDays, weekStart } from "./dates";
import { matchScore } from "./search";
import type { Milestone, Priority, Task, TaskStatus } from "../types";

/**
 * What the Overview, Tasks and Roadmap read from the same records: nothing is copied by hand, and
 * nothing is invented (a count is shown only when the records behind it exist).
 */

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** A task to do or in progress (done, cancelled and archived ones are history). */
export function isOpen(t: Task): boolean {
  return !t.archived_at && (t.status === "todo" || t.status === "in_progress");
}

/** A task that counts in a milestone's progress (cancelled and archived ones do not). */
export function counts(t: Task): boolean {
  return !t.archived_at && t.status !== "cancelled";
}

export function dueTone(due: string | null, today: string): "overdue" | "today" | "soon" | null {
  if (!due) return null;
  const d = diffDays(today, due);
  return d < 0 ? "overdue" : d === 0 ? "today" : d <= 3 ? "soon" : null;
}

export type Progress = { done: number; total: number; ratio: number | null };

export function milestoneProgress(milestoneId: string, tasks: Task[]): Progress {
  const mine = tasks.filter((t) => t.milestone_id === milestoneId && counts(t));
  const done = mine.filter((t) => t.status === "done").length;
  return { done, total: mine.length, ratio: mine.length ? done / mine.length : null };
}

export type FocusReason = "overdue" | "today" | "high" | "in_progress" | "soon" | "next";

/**
 * Today's focus, chosen from the task list: late or due today first, then high priority and work in
 * progress, then what is due within three days. When nothing stands out, the next tasks by priority
 * and date, up to three. At most `limit` tasks.
 */
export function focusTasks(tasks: Task[], today: string, limit = 5): { task: Task; reason: FocusReason }[] {
  const open = tasks.filter(isOpen);
  const scored = open.map((task) => {
    const tone = dueTone(task.due_date, today);
    let score = 0;
    let reason: FocusReason = "next";
    if (tone === "overdue") [score, reason] = [100 + Math.min(30, -diffDays(today, task.due_date!)), "overdue"];
    else if (tone === "today") [score, reason] = [90, "today"];
    else if (task.priority === "high") [score, reason] = [task.status === "in_progress" ? 80 : tone === "soon" ? 75 : 60, "high"];
    else if (task.status === "in_progress") [score, reason] = [55, "in_progress"];
    else if (tone === "soon") [score, reason] = [50, "soon"];
    return { task, reason, score };
  });
  const byOrder = (a: { task: Task; score: number }, b: { task: Task; score: number }) =>
    b.score - a.score ||
    PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
    (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999") ||
    a.task.sort_order - b.task.sort_order;
  const picked = scored.filter((s) => s.score > 0).sort(byOrder).slice(0, limit);
  if (picked.length >= 3) return picked.map(({ task, reason }) => ({ task, reason }));
  const rest = scored.filter((s) => s.score === 0).sort(byOrder).slice(0, 3 - picked.length);
  return [...picked, ...rest].map(({ task, reason }) => ({ task, reason }));
}

/** Milestones still ahead: dated ones by date (late ones first), then those to schedule. */
export function upcomingMilestones(milestones: Milestone[], limit = 4): Milestone[] {
  return milestones
    .filter((m) => !m.archived_at && m.status !== "done")
    .sort((a, b) => (a.target_date && b.target_date ? a.target_date.localeCompare(b.target_date) : a.target_date ? -1 : b.target_date ? 1 : a.sort_order - b.sort_order))
    .slice(0, limit);
}

export type Indicators = {
  highOpen: number;
  doneThisWeek: number;
  nextMilestone: Milestone | null;
  roadmap: { done: number; total: number };
  hasTasks: boolean;
};

/** The four numbers of the Overview, counted from the records (the week starts on Monday). */
export function indicators(tasks: Task[], milestones: Milestone[], today: string, weekStartsOn = weekStart(today)): Indicators {
  const live = milestones.filter((m) => !m.archived_at);
  return {
    highOpen: tasks.filter((t) => isOpen(t) && t.priority === "high").length,
    doneThisWeek: tasks.filter((t) => !t.archived_at && t.status === "done" && t.completed_at && t.completed_at.slice(0, 10) >= weekStartsOn).length,
    nextMilestone: upcomingMilestones(milestones, 1)[0] ?? null,
    roadmap: { done: live.filter((m) => m.status === "done").length, total: live.length },
    hasTasks: tasks.some((t) => !t.archived_at),
  };
}

export type DueFilter = "overdue" | "today" | "week" | "none";
export type TaskFilter = { priorities: Priority[]; statuses: Exclude<TaskStatus, "done">[]; due: DueFilter | null; categories: string[]; query: string };
export const NO_FILTER: TaskFilter = { priorities: [], statuses: [], due: null, categories: [], query: "" };
export const NO_CATEGORY = "none";

export function matchesFilter(t: Task, f: TaskFilter, today: string): boolean {
  if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
  if (f.statuses.length && !f.statuses.includes(t.status as Exclude<TaskStatus, "done">)) return false;
  if (f.categories.length && !f.categories.includes(t.category_id ?? NO_CATEGORY)) return false;
  if (f.due === "none" && t.due_date) return false;
  if (f.due === "overdue" && dueTone(t.due_date, today) !== "overdue") return false;
  if (f.due === "today" && !(t.due_date && t.due_date <= today)) return false;
  if (f.due === "week" && !(t.due_date && t.due_date <= addDays(today, 7))) return false;
  if (f.query.trim() && !matchScore(f.query, `${t.title} ${t.description ?? ""}`)) return false;
  return true;
}

export function filterCount(f: TaskFilter): number {
  return f.priorities.length + f.statuses.length + f.categories.length + (f.due ? 1 : 0);
}

/** A position between two neighbours (drag and drop keeps the others where they are). */
export function between(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}
