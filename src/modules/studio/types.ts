import type { Tables } from "@/lib/supabase/database.types";

/**
 * Studio: our team's space to build and run Cendr — Overview, Tasks, Roadmap, Knowledge. Internal
 * only (platform admins), never shown to customers. Each piece of information exists once: a task's
 * milestone, a milestone's progress and the overview are all read from the same records.
 */

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export const PRIORITIES = ["high", "medium", "low"] as const;
export const MILESTONE_STATUSES = ["planned", "in_progress", "done"] as const;
export const CATEGORY_KEYS = ["strategy", "product", "marketing", "growth", "sales", "finance", "operations", "legal"] as const;
/** Icons a category can take (lucide names). */
export const CATEGORY_ICONS = [
  "compass",
  "box",
  "megaphone",
  "trending-up",
  "handshake",
  "wallet",
  "settings",
  "shield",
  "folder",
  "book",
  "lightbulb",
  "users",
  "target",
  "rocket",
  "heart",
  "star",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export type CategoryKey = (typeof CATEGORY_KEYS)[number];
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

type Narrow<T, O> = Omit<T, keyof O> & O;

/** The columns Studio uses (older Scale columns stay in the database, untouched). */
export type Task = Pick<
  Narrow<Tables<"scale_tasks">, { status: TaskStatus | "cancelled"; priority: Priority }>,
  "id" | "title" | "description" | "status" | "priority" | "due_date" | "category_id" | "milestone_id" | "sort_order" | "completed_at" | "created_at" | "updated_at" | "archived_at"
>;
export type Milestone = Pick<
  Narrow<Tables<"scale_milestones">, { status: MilestoneStatus }>,
  "id" | "title" | "description" | "target_date" | "achieved_date" | "status" | "category_id" | "sort_order" | "created_at" | "updated_at" | "archived_at"
>;
export type Category = Pick<Tables<"scale_categories">, "id" | "key" | "name" | "icon" | "sort_order" | "created_at" | "updated_at">;
export type StudioDocument = Pick<
  Tables<"scale_documents">,
  "id" | "title" | "category_id" | "tags" | "is_pinned" | "created_at" | "updated_at" | "archived_at" | "content"
>;
export type DocumentMeta = Omit<StudioDocument, "content">;
export type TaskDocument = Pick<Tables<"scale_task_documents">, "task_id" | "document_id">;
export type MilestoneDocument = Pick<Tables<"scale_milestone_documents">, "milestone_id" | "document_id">;
export type Visit = Pick<Tables<"scale_document_visits">, "document_id" | "opened_at">;

export const TASK_COLUMNS = "id, title, description, status, priority, due_date, category_id, milestone_id, sort_order, completed_at, created_at, updated_at, archived_at";
export const MILESTONE_COLUMNS = "id, title, description, target_date, achieved_date, status, category_id, sort_order, created_at, updated_at, archived_at";
export const CATEGORY_COLUMNS = "id, key, name, icon, sort_order, created_at, updated_at";
export const DOCUMENT_META = "id, title, category_id, tags, is_pinned, created_at, updated_at, archived_at";

export type StudioSnapshot = {
  tasks: Task[];
  milestones: Milestone[];
  categories: Category[];
  documents: DocumentMeta[];
  taskDocuments: TaskDocument[];
  milestoneDocuments: MilestoneDocument[];
  visits: Visit[];
  me: { id: string; firstName: string | null };
  /** When this copy was read (a newer copy replaces an older one). */
  loadedAt: number;
};

export type StudioError = "forbidden" | "not_found" | "validation" | "conflict" | "unknown";
export type StudioResult<T = undefined> = { ok: true; data: T } | { ok: false; error: StudioError; current?: unknown };

/** What the side panel shows (`?open=task:<id>`). */
export const PANEL_KINDS = ["task", "milestone"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/** A document found by content (server search). */
export type ContentHit = { id: string; title: string; categoryId: string | null; snippet: string; score: number };
