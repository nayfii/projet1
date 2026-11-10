"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { blocksSchema, blocksText, type Block } from "../logic/blocks";
import { addDays, todayIso, weekStart } from "../logic/dates";
import { nextOccurrence, wouldCreateCycle, type Edge } from "../logic/planning";
import { bulkTaskSchema, createSchema, entityTypeSchema, linkTypeSchema, patchSchema, reviewSchema, settingsSchema, viewSchema, weekSchema } from "../schemas";
import { DOC_TEMPLATES, docTemplate, metricSuggestions, starterPlan, TEST_TEMPLATES, testTemplate } from "../templates";
import { ARCHIVABLE, ENTITIES, LINK_ROLES, type Activity, type Attachment, type Comment, type Entity, type ScaleDocument, type ScaleResult, type ScaleSnapshot, type Settings, type Week, type WeeklyReview } from "../types";
import { DOCUMENT_META, getScaleSnapshot } from "./queries";

/**
 * Every change made in Scale. Each action checks that the caller is in our team (platform admin);
 * Row Level Security checks it again in the database. Logs hold no customer content.
 */

const TABLE: Record<Entity, string> = {
  objective: "scale_objectives",
  project: "scale_projects",
  milestone: "scale_milestones",
  task: "scale_tasks",
  test: "scale_tests",
  comparison: "scale_test_comparisons",
  observation: "scale_observations",
  document: "scale_documents",
  decision: "scale_decisions",
  metric: "scale_metrics",
  measurement: "scale_measurements",
  simulation: "scale_simulations",
};
const NO_CREATED_BY = new Set<Entity>(["comparison"]);
const NAME_FIELD: Partial<Record<Entity, string>> = { decision: "subject", metric: "name", simulation: "name", comparison: "label", observation: "body" };

/** Changes worth keeping in an item's history. */
const TRACKED: Partial<Record<Entity, string[]>> = {
  objective: ["title", "status", "validation_state", "current_value", "target", "due_date", "owner_id", "is_focus"],
  project: ["title", "status", "health", "priority", "owner_id", "start_date", "target_date", "achieved_date", "objective_id", "horizon"],
  milestone: ["title", "target_date", "achieved_date"],
  task: ["title", "status", "priority", "owner_id", "start_date", "due_date", "week_start", "project_id", "milestone_id", "estimate_hours"],
  test: ["title", "status", "conclusion", "success_criterion", "start_date", "end_date", "owner_id", "continuation"],
  decision: ["subject", "status", "choice", "review_on"],
};

type Db = SupabaseClient;
type Row = Record<string, unknown> & { id: string; updated_at?: string };

async function team(): Promise<{ db: Db; userId: string } | null> {
  const ctx = await platformAdminOrNull();
  if (!ctx) return null;
  return { db: (await createClient()) as unknown as Db, userId: ctx.user.id };
}

const fail = <T>(error: "forbidden" | "not_found" | "validation" | "conflict" | "cycle" | "unknown", current?: unknown): ScaleResult<T> => ({ ok: false, error, current });

function entityOf(value: unknown): Entity | null {
  return (ENTITIES as readonly string[]).includes(value as string) ? (value as Entity) : null;
}

function nameOf(entity: Entity, row: Record<string, unknown>): string {
  const v = row[NAME_FIELD[entity] ?? "title"];
  return typeof v === "string" ? v.slice(0, 200) : "";
}

async function log(db: Db, userId: string, entityType: string, entityId: string | null, action: string, details: Record<string, unknown> = {}) {
  await db.from("scale_activity").insert({ entity_type: entityType, entity_id: entityId, actor_id: userId, action, details });
}

/** Activity rows for the tracked fields that changed, with the moments that count as progress. */
async function logChanges(db: Db, userId: string, entity: Entity, before: Row, after: Row) {
  const fields = TRACKED[entity] ?? [];
  const title = nameOf(entity, after);
  const rows: { entity_type: string; entity_id: string; actor_id: string; action: string; details: Record<string, unknown> }[] = [];
  for (const field of fields) {
    if (JSON.stringify(before[field] ?? null) === JSON.stringify(after[field] ?? null)) continue;
    let action = "changed";
    if (entity === "test" && field === "success_criterion" && before.started_at) action = "criterion_changed";
    if (entity === "milestone" && field === "achieved_date" && after.achieved_date) action = "milestone_reached";
    if (entity === "test" && field === "conclusion" && after.conclusion) action = "test_concluded";
    if (entity === "decision" && field === "status" && after.status === "decided") action = "decision_taken";
    if (entity === "project" && field === "status" && after.status === "done") action = "project_done";
    if (entity === "objective" && ((field === "status" && after.status === "achieved") || (field === "validation_state" && after.validation_state === "validated"))) action = "objective_reached";
    rows.push({ entity_type: entity, entity_id: after.id, actor_id: userId, action, details: { field, from: before[field] ?? null, to: after[field] ?? null, title } });
  }
  if (rows.length) await db.from("scale_activity").insert(rows);
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export async function refreshScale(): Promise<ScaleResult<ScaleSnapshot>> {
  const ctx = await platformAdminOrNull();
  if (!ctx) return fail("forbidden");
  return { ok: true, data: await getScaleSnapshot(ctx) };
}

// ─── Generic create / update / archive / delete ─────────────────────────────

export async function createRecord(entityName: Entity, values: Record<string, unknown>): Promise<ScaleResult<Row>> {
  const t = await team();
  const entity = entityOf(entityName);
  if (!t) return fail("forbidden");
  if (!entity) return fail("validation");
  const parsed = createSchema(entity).safeParse(values);
  if (!parsed.success) return fail("validation");
  const insert: Record<string, unknown> = { ...parsed.data };
  if (!NO_CREATED_BY.has(entity)) insert.created_by = t.userId;
  if (entity === "document") {
    const key = (DOC_TEMPLATES as readonly string[]).includes(String(insert.template_key)) ? (insert.template_key as (typeof DOC_TEMPLATES)[number]) : "blank";
    insert.content = docTemplate(key, (await getLocale()) === "en" ? "en" : "fr").content;
    insert.updated_by = t.userId;
  }
  if (entity === "test" && insert.status === "running") insert.started_at = new Date().toISOString();
  if (entity === "task" && insert.status === "done") insert.completed_at = new Date().toISOString();
  if (entity === "objective" && insert.is_focus) await t.db.from("scale_objectives").update({ is_focus: false }).eq("is_focus", true);

  const select = entity === "document" ? DOCUMENT_META : "*";
  const query = entity === "measurement"
    ? t.db.from(TABLE.measurement).upsert(insert, { onConflict: "metric_id,period_start,kind" }).select(select).single()
    : t.db.from(TABLE[entity]).insert(insert).select(select).single();
  const { data, error } = await query;
  if (error || !data) return fail(error?.code === "23503" ? "not_found" : error?.code === "23514" ? "validation" : "unknown");
  const row = data as unknown as Row;
  if (entity !== "comparison" && entity !== "measurement") await log(t.db, t.userId, entity, row.id, "created", { title: nameOf(entity, row) });
  return { ok: true, data: row };
}

export async function updateRecord(
  entityName: Entity,
  id: string,
  patch: Record<string, unknown>,
  expectedUpdatedAt?: string,
): Promise<ScaleResult<{ row: Row; created?: Row }>> {
  const t = await team();
  const entity = entityOf(entityName);
  if (!t) return fail("forbidden");
  if (!entity || !z.uuid().safeParse(id).success) return fail("validation");
  const parsed = patchSchema(entity).safeParse(patch);
  if (!parsed.success) return fail("validation");
  const select = entity === "document" ? DOCUMENT_META : "*";
  const { data: before } = await t.db.from(TABLE[entity]).select(select).eq("id", id).maybeSingle();
  if (!before) return fail("not_found");
  const prev = before as unknown as Row;
  if (expectedUpdatedAt && prev.updated_at && prev.updated_at !== expectedUpdatedAt) return fail("conflict", prev);

  const update: Record<string, unknown> = { ...parsed.data };
  const now = new Date().toISOString();
  if (entity === "task" && "status" in update) {
    if (update.status === "done" && prev.status !== "done") update.completed_at = now;
    if (update.status !== "done") update.completed_at = null;
  }
  if (entity === "task" && update.parent_id === id) return fail("validation");
  if (entity === "test" && update.status && ["running", "to_analyze", "done"].includes(String(update.status)) && !prev.started_at) update.started_at = now;
  if (entity === "objective" && ["current_value", "target", "baseline"].some((k) => k in update)) update.metric_updated_at = now;
  if (entity === "objective" && update.is_focus === true) await t.db.from("scale_objectives").update({ is_focus: false }).eq("is_focus", true).neq("id", id);

  let query = t.db.from(TABLE[entity]).update(update).eq("id", id);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await query.select(select).maybeSingle();
  if (error) return fail(error.code === "23514" ? "validation" : error.code === "23503" ? "not_found" : "unknown");
  if (!data) {
    const { data: current } = await t.db.from(TABLE[entity]).select(select).eq("id", id).maybeSingle();
    return current ? fail("conflict", current) : fail("not_found");
  }
  const row = data as unknown as Row;
  await logChanges(t.db, t.userId, entity, prev, row);

  // A recurring task done: the next occurrence is created, on the following date.
  let created: Row | undefined;
  if (entity === "task" && update.status === "done" && prev.status !== "done" && row.recurrence) {
    const base = (row.due_date as string | null) ?? todayIso();
    const due = nextOccurrence(base, String(row.recurrence));
    const { data: next } = await t.db
      .from("scale_tasks")
      .insert({
        title: row.title,
        description: row.description,
        project_id: row.project_id,
        milestone_id: row.milestone_id,
        owner_id: row.owner_id,
        priority: row.priority,
        kind: row.kind,
        estimate_hours: row.estimate_hours,
        done_criterion: row.done_criterion,
        recurrence: row.recurrence,
        status: "todo",
        due_date: due,
        week_start: row.week_start ? weekStart(due) : null,
        created_by: t.userId,
      })
      .select("*")
      .single();
    if (next) created = next as unknown as Row;
  }
  return { ok: true, data: { row, created } };
}

export async function archiveRecord(entityName: Entity, id: string, archived: boolean): Promise<ScaleResult<Row>> {
  const t = await team();
  const entity = entityOf(entityName);
  if (!t) return fail("forbidden");
  if (!entity || !ARCHIVABLE.includes(entity) || !z.uuid().safeParse(id).success) return fail("validation");
  const patch: Record<string, unknown> = { archived_at: archived ? new Date().toISOString() : null };
  if (entity === "objective" && archived) patch.is_focus = false;
  const { data, error } = await t.db.from(TABLE[entity]).update(patch).eq("id", id).select(entity === "document" ? DOCUMENT_META : "*").maybeSingle();
  if (error || !data) return fail(error ? "unknown" : "not_found");
  const row = data as unknown as Row;
  await log(t.db, t.userId, entity, id, archived ? "archived" : "restored", { title: nameOf(entity, row) });
  return { ok: true, data: row };
}

/** Permanent deletion: only from the archives (archive first), or for the small rows of a test or an indicator. */
export async function deleteRecord(entityName: Entity, id: string): Promise<ScaleResult<{ id: string }>> {
  const t = await team();
  const entity = entityOf(entityName);
  if (!t) return fail("forbidden");
  if (!entity || !z.uuid().safeParse(id).success) return fail("validation");
  const select = entity === "document" ? DOCUMENT_META : "*";
  const { data: row } = await t.db.from(TABLE[entity]).select(select).eq("id", id).maybeSingle();
  if (!row) return fail("not_found");
  const r = row as unknown as Row;
  if (ARCHIVABLE.includes(entity) && !r.archived_at) return fail("validation");
  // Files, comments and customer links belonging to it go with it.
  const { data: files } = await t.db.from("scale_attachments").select("storage_path").eq("entity_type", entity).eq("entity_id", id).eq("kind", "file");
  const paths = (files ?? []).map((f) => f.storage_path as string).filter(Boolean);
  if (paths.length) await t.db.storage.from("scale-files").remove(paths);
  await Promise.all([
    t.db.from("scale_attachments").delete().eq("entity_type", entity).eq("entity_id", id),
    t.db.from("scale_comments").delete().eq("entity_type", entity).eq("entity_id", id),
    t.db.from("scale_company_links").delete().eq("entity_type", entity).eq("entity_id", id),
  ]);
  const { error } = await t.db.from(TABLE[entity]).delete().eq("id", id);
  if (error) return fail("unknown");
  if (ARCHIVABLE.includes(entity)) await log(t.db, t.userId, entity, null, "deleted", { title: nameOf(entity, r) });
  return { ok: true, data: { id } };
}

/** A copy next to the original (a project comes with its milestones and tasks, a task with its sub-tasks). */
export async function duplicateRecord(entityName: Entity, id: string, suffix: string): Promise<ScaleResult<{ rows: { entity: Entity; row: Row }[] }>> {
  const t = await team();
  const entity = entityOf(entityName);
  if (!t) return fail("forbidden");
  if (!entity || !["task", "project", "test", "document", "decision", "objective"].includes(entity) || !z.uuid().safeParse(id).success) return fail("validation");
  const { data: source } = await t.db.from(TABLE[entity]).select("*").eq("id", id).maybeSingle();
  if (!source) return fail("not_found");
  const strip = (r: Record<string, unknown>) => {
    const copy = { ...r };
    for (const k of ["id", "created_at", "updated_at", "archived_at", "completed_at", "started_at", "is_focus", "achieved_date", "metric_updated_at"]) delete copy[k];
    if ("created_by" in copy) copy.created_by = t.userId;
    return copy;
  };
  const field = NAME_FIELD[entity] ?? "title";
  const copy = strip(source as Record<string, unknown>);
  copy[field] = `${String(copy[field])} ${suffix.slice(0, 30)}`.slice(0, 200);
  if (entity === "task") copy.status = copy.status === "done" || copy.status === "cancelled" ? "todo" : copy.status;
  if (entity === "test") Object.assign(copy, { status: "to_prepare", conclusion: null, results: null, conclusion_note: null, budget_actual: null });
  if (entity === "document") copy.updated_by = t.userId;
  const { data: made, error } = await t.db.from(TABLE[entity]).insert(copy).select(entity === "document" ? DOCUMENT_META : "*").single();
  if (error || !made) return fail("unknown");
  const out: { entity: Entity; row: Row }[] = [{ entity, row: made as unknown as Row }];
  const newId = (made as unknown as Row).id;

  if (entity === "project") {
    const { data: milestones } = await t.db.from("scale_milestones").select("*").eq("project_id", id).is("archived_at", null);
    const milestoneMap = new Map<string, string>();
    for (const m of milestones ?? []) {
      const { data: nm } = await t.db.from("scale_milestones").insert({ ...strip(m), project_id: newId }).select("*").single();
      if (nm) {
        milestoneMap.set(m.id as string, (nm as Row).id);
        out.push({ entity: "milestone", row: nm as Row });
      }
    }
    const { data: tasks } = await t.db.from("scale_tasks").select("*").eq("project_id", id).is("parent_id", null).is("archived_at", null);
    for (const task of tasks ?? []) {
      const status = task.status === "done" || task.status === "cancelled" ? "todo" : task.status;
      const { data: nt } = await t.db
        .from("scale_tasks")
        .insert({ ...strip(task), project_id: newId, milestone_id: task.milestone_id ? (milestoneMap.get(task.milestone_id as string) ?? null) : null, status })
        .select("*")
        .single();
      if (nt) out.push({ entity: "task", row: nt as Row });
    }
  }
  if (entity === "task") {
    const { data: subs } = await t.db.from("scale_tasks").select("*").eq("parent_id", id).is("archived_at", null);
    for (const s of subs ?? []) {
      const { data: ns } = await t.db.from("scale_tasks").insert({ ...strip(s), parent_id: newId, status: "todo" }).select("*").single();
      if (ns) out.push({ entity: "task", row: ns as Row });
    }
  }
  await log(t.db, t.userId, entity, newId, "duplicated", { title: nameOf(entity, made as unknown as Record<string, unknown>) });
  return { ok: true, data: { rows: out } };
}

export async function bulkUpdateTasks(ids: string[], patch: Record<string, unknown>): Promise<ScaleResult<Row[]>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const list = z.array(z.uuid()).min(1).max(200).safeParse(ids);
  const parsed = bulkTaskSchema.safeParse(patch);
  if (!list.success || !parsed.success) return fail("validation");
  const update: Record<string, unknown> = { ...parsed.data };
  if (update.status === "done") update.completed_at = new Date().toISOString();
  else if (update.status) update.completed_at = null;
  const { data: before } = await t.db.from("scale_tasks").select("*").in("id", list.data);
  const { data, error } = await t.db.from("scale_tasks").update(update).in("id", list.data).select("*");
  if (error) return fail("unknown");
  const prev = new Map((before ?? []).map((r) => [r.id as string, r as Row]));
  for (const row of data ?? []) {
    const p = prev.get(row.id as string);
    if (p) await logChanges(t.db, t.userId, "task", p, row as Row);
  }
  return { ok: true, data: (data ?? []) as Row[] };
}

export async function bulkArchiveTasks(ids: string[], archived: boolean): Promise<ScaleResult<Row[]>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const list = z.array(z.uuid()).min(1).max(200).safeParse(ids);
  if (!list.success) return fail("validation");
  const { data, error } = await t.db.from("scale_tasks").update({ archived_at: archived ? new Date().toISOString() : null }).in("id", list.data).select("*");
  if (error) return fail("unknown");
  for (const row of data ?? []) await log(t.db, t.userId, "task", row.id as string, archived ? "archived" : "restored", { title: row.title });
  return { ok: true, data: (data ?? []) as Row[] };
}

// ─── Dependencies and rescheduling ──────────────────────────────────────────

const DEP_TABLE = { task: "scale_task_dependencies", project: "scale_project_dependencies" } as const;
const DEP_KEY = { task: "task_id", project: "project_id" } as const;

/** "id depends on dependsOn". Refused when it would close a loop. */
export async function setDependency(kind: "task" | "project", id: string, dependsOn: string, on: boolean): Promise<ScaleResult<{ from: string; to: string }>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!(kind in DEP_TABLE) || !z.uuid().safeParse(id).success || !z.uuid().safeParse(dependsOn).success || id === dependsOn) return fail(id === dependsOn ? "cycle" : "validation");
  const table = DEP_TABLE[kind];
  const key = DEP_KEY[kind];
  if (!on) {
    await t.db.from(table).delete().eq(key, id).eq("depends_on_id", dependsOn);
    await log(t.db, t.userId, kind, id, "dependency_removed", { on: dependsOn });
    return { ok: true, data: { from: id, to: dependsOn } };
  }
  const { data: rows } = await t.db.from(table).select(`${key}, depends_on_id`);
  const edges: Edge[] = (rows ?? []).map((r) => ({ from: (r as Record<string, string>)[key], to: (r as Record<string, string>).depends_on_id }));
  if (wouldCreateCycle(edges, id, dependsOn)) return fail("cycle");
  const { error } = await t.db.from(table).upsert({ [key]: id, depends_on_id: dependsOn }, { onConflict: `${key},depends_on_id`, ignoreDuplicates: true });
  if (error) return fail(error.code === "23503" ? "not_found" : "unknown");
  await log(t.db, t.userId, kind, id, "dependency_added", { on: dependsOn });
  return { ok: true, data: { from: id, to: dependsOn } };
}

const dateChange = z.object({ id: z.uuid(), start: z.string().nullable(), end: z.string().nullable() });

/** Applies a rescheduling that the person has seen first (with or without its cascade). */
export async function applyDateChanges(kind: "task" | "project" | "milestone", changes: { id: string; start: string | null; end: string | null }[]): Promise<ScaleResult<Row[]>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = z.array(dateChange).min(1).max(200).safeParse(changes);
  if (!parsed.success || !["task", "project", "milestone"].includes(kind)) return fail("validation");
  const entity: Entity = kind;
  const out: Row[] = [];
  for (const c of parsed.data) {
    const patch: Record<string, unknown> =
      kind === "project" ? { start_date: c.start, target_date: c.end } : kind === "task" ? { start_date: c.start, due_date: c.end } : { target_date: c.end };
    const res = await updateRecord(entity, c.id, patch);
    if (!res.ok) return res.error === "validation" ? fail("validation") : fail(res.error);
    out.push(res.data.row);
  }
  return { ok: true, data: out };
}

// ─── Comments, links and files, history ─────────────────────────────────────

export async function getDetails(entityType: string, id: string): Promise<ScaleResult<{ comments: Comment[]; attachments: Attachment[]; activity: Activity[] }>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success || !z.uuid().safeParse(id).success) return fail("validation");
  const [comments, attachments, activity] = await Promise.all([
    t.db.from("scale_comments").select("*").eq("entity_type", type.data).eq("entity_id", id).order("created_at"),
    t.db.from("scale_attachments").select("*").eq("entity_type", type.data).eq("entity_id", id).order("created_at"),
    t.db.from("scale_activity").select("*").eq("entity_type", type.data).eq("entity_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  return { ok: true, data: { comments: (comments.data ?? []) as Comment[], attachments: (attachments.data ?? []) as Attachment[], activity: (activity.data ?? []) as Activity[] } };
}

export async function addComment(entityType: string, id: string, body: string): Promise<ScaleResult<Comment>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const type = entityTypeSchema.safeParse(entityType);
  const text = z.string().trim().min(1).max(5000).safeParse(body);
  if (!type.success || !text.success || !z.uuid().safeParse(id).success) return fail("validation");
  const { data, error } = await t.db.from("scale_comments").insert({ entity_type: type.data, entity_id: id, author_id: t.userId, body: text.data }).select("*").single();
  if (error || !data) return fail("unknown");
  return { ok: true, data: data as Comment };
}

export async function deleteComment(id: string): Promise<ScaleResult<{ id: string }>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!z.uuid().safeParse(id).success) return fail("validation");
  // Each person removes their own comments only.
  const { data } = await t.db.from("scale_comments").delete().eq("id", id).eq("author_id", t.userId).select("id");
  return data?.length ? { ok: true, data: { id } } : fail("not_found");
}

export async function addLink(entityType: string, id: string, label: string, url: string): Promise<ScaleResult<Attachment>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const type = entityTypeSchema.safeParse(entityType);
  const parsedUrl = z.url({ protocol: /^https?$/ }).max(2000).safeParse(url.trim());
  if (!type.success || !parsedUrl.success || !z.uuid().safeParse(id).success) return fail("validation");
  const name = (label.trim() || parsedUrl.data).slice(0, 200);
  const { data, error } = await t.db.from("scale_attachments").insert({ entity_type: type.data, entity_id: id, kind: "link", label: name, url: parsedUrl.data, created_by: t.userId }).select("*").single();
  if (error || !data) return fail("unknown");
  return { ok: true, data: data as Attachment };
}

const MAX_FILE = 10 * 1024 * 1024;

export async function uploadFile(form: FormData): Promise<ScaleResult<Attachment>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const type = entityTypeSchema.safeParse(form.get("entityType"));
  const id = z.uuid().safeParse(form.get("entityId"));
  const file = form.get("file");
  if (!type.success || !id.success || !(file instanceof File) || file.size === 0 || file.size > MAX_FILE) return fail("validation");
  const safeName = file.name.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80) || "file";
  const path = `${type.data}/${id.data}/${crypto.randomUUID()}-${safeName}`;
  const { error: upload } = await t.db.storage.from("scale-files").upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (upload) return fail("unknown");
  const { data, error } = await t.db
    .from("scale_attachments")
    .insert({ entity_type: type.data, entity_id: id.data, kind: "file", label: file.name.slice(0, 200), storage_path: path, mime_type: (file.type || "application/octet-stream").slice(0, 120), size_bytes: file.size, created_by: t.userId })
    .select("*")
    .single();
  if (error || !data) {
    await t.db.storage.from("scale-files").remove([path]);
    return fail("unknown");
  }
  return { ok: true, data: data as Attachment };
}

export async function deleteAttachment(id: string): Promise<ScaleResult<{ id: string }>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!z.uuid().safeParse(id).success) return fail("validation");
  const { data } = await t.db.from("scale_attachments").select("storage_path").eq("id", id).maybeSingle();
  if (!data) return fail("not_found");
  if (data.storage_path) await t.db.storage.from("scale-files").remove([data.storage_path as string]);
  await t.db.from("scale_attachments").delete().eq("id", id);
  return { ok: true, data: { id } };
}

// ─── Links to existing customer companies ───────────────────────────────────

export async function linkCompany(entityType: string, entityId: string, companyId: string, role: string, note: string | null): Promise<ScaleResult<Row>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const type = linkTypeSchema.safeParse(entityType);
  const parsedRole = z.enum(LINK_ROLES).safeParse(role);
  const parsedNote = z.string().max(2000).nullable().safeParse(note?.trim() ? note.trim() : null);
  if (!type.success || !parsedRole.success || !parsedNote.success || !z.uuid().safeParse(entityId).success || !z.uuid().safeParse(companyId).success) return fail("validation");
  const { data, error } = await t.db
    .from("scale_company_links")
    .upsert({ entity_type: type.data, entity_id: entityId, company_id: companyId, role: parsedRole.data, note: parsedNote.data, created_by: t.userId }, { onConflict: "company_id,entity_type,entity_id" })
    .select("*")
    .single();
  if (error || !data) return fail(error?.code === "23503" ? "not_found" : "unknown");
  await log(t.db, t.userId, type.data, entityId, "company_linked", { role: parsedRole.data });
  return { ok: true, data: data as Row };
}

export async function unlinkCompany(linkId: string): Promise<ScaleResult<{ id: string }>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!z.uuid().safeParse(linkId).success) return fail("validation");
  const { data } = await t.db.from("scale_company_links").delete().eq("id", linkId).select("entity_type, entity_id");
  if (!data?.length) return fail("not_found");
  await log(t.db, t.userId, data[0].entity_type as string, data[0].entity_id as string, "company_unlinked");
  return { ok: true, data: { id: linkId } };
}

// ─── Weeks, weekly review, settings, saved views ────────────────────────────

const mondaySchema = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).getUTCDay() === 1);

export async function saveWeek(monday: string, values: Record<string, unknown>): Promise<ScaleResult<Week>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = weekSchema.safeParse(values);
  if (!mondaySchema.safeParse(monday).success || !parsed.success) return fail("validation");
  const { data, error } = await t.db.from("scale_weeks").upsert({ week_start: monday, ...parsed.data }, { onConflict: "week_start" }).select("*").single();
  if (error || !data) return fail("unknown");
  return { ok: true, data: data as Week };
}

export async function saveReview(monday: string, values: Record<string, unknown>, complete: boolean): Promise<ScaleResult<WeeklyReview>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = reviewSchema.safeParse(values);
  if (!mondaySchema.safeParse(monday).success || !parsed.success) return fail("validation");
  const row: Record<string, unknown> = { week_start: monday, ...parsed.data, created_by: t.userId };
  if (complete) row.completed_at = new Date().toISOString();
  const { data, error } = await t.db.from("scale_weekly_reviews").upsert(row, { onConflict: "week_start" }).select("*").single();
  if (error || !data) return fail("unknown");
  if (complete) await log(t.db, t.userId, "review", null, "review_done", { week: monday });
  return { ok: true, data: data as WeeklyReview };
}

/** Unfinished tasks of a week: never moved silently. Each one is replanned, put off or dropped. */
export async function resolveCarryOver(choices: { id: string; action: "next_week" | "later" | "drop" }[], nextMonday: string): Promise<ScaleResult<Row[]>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = z.array(z.object({ id: z.uuid(), action: z.enum(["next_week", "later", "drop"]) })).max(200).safeParse(choices);
  if (!parsed.success || !mondaySchema.safeParse(nextMonday).success) return fail("validation");
  const out: Row[] = [];
  for (const c of parsed.data) {
    const patch = c.action === "next_week" ? { week_start: nextMonday } : c.action === "later" ? { week_start: null } : { status: "cancelled" };
    const res = await updateRecord("task", c.id, patch);
    if (res.ok) out.push(res.data.row);
  }
  return { ok: true, data: out };
}

export async function saveSettings(values: Record<string, unknown>): Promise<ScaleResult<Settings>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = settingsSchema.safeParse(values);
  if (!parsed.success) return fail("validation");
  const { data, error } = await t.db.from("scale_settings").upsert({ id: true, ...parsed.data, updated_by: t.userId }, { onConflict: "id" }).select("*").single();
  if (error || !data) return fail("unknown");
  return { ok: true, data: data as Settings };
}

/** First visit: an empty space, or the Cendr starting structure (suggestions, no dates, no results). */
export async function startScale(mode: "empty" | "cendr", values: Record<string, unknown>): Promise<ScaleResult<ScaleSnapshot>> {
  const ctx = await platformAdminOrNull();
  const t = await team();
  if (!t || !ctx) return fail("forbidden");
  const parsed = settingsSchema.safeParse(values);
  if (!parsed.success || !["empty", "cendr"].includes(mode)) return fail("validation");
  const { error } = await t.db.from("scale_settings").upsert({ id: true, ...parsed.data, onboarded_at: new Date().toISOString(), updated_by: t.userId }, { onConflict: "id" });
  if (error) return fail("unknown");
  if (mode === "cendr") {
    const res = await addStarter(t.db, t.userId, (await getLocale()) === "en" ? "en" : "fr");
    if (!res) return fail("unknown");
  }
  await log(t.db, t.userId, "settings", null, mode === "cendr" ? "started_with_template" : "started_empty");
  return { ok: true, data: await getScaleSnapshot(ctx) };
}

/** Adds the Cendr starting structure later (what is already there is not added twice). */
export async function addCendrStarter(): Promise<ScaleResult<ScaleSnapshot>> {
  const ctx = await platformAdminOrNull();
  const t = await team();
  if (!t || !ctx) return fail("forbidden");
  const res = await addStarter(t.db, t.userId, (await getLocale()) === "en" ? "en" : "fr");
  if (!res) return fail("unknown");
  await t.db.from("scale_settings").upsert({ id: true, onboarded_at: new Date().toISOString(), updated_by: t.userId }, { onConflict: "id" });
  return { ok: true, data: await getScaleSnapshot(ctx) };
}

async function addStarter(db: Db, userId: string, locale: "fr" | "en"): Promise<boolean> {
  const plan = starterPlan(locale);
  const { data: existing } = await db.from("scale_projects").select("template_key").not("template_key", "is", null);
  const done = new Set((existing ?? []).map((r) => r.template_key as string));

  let objectiveId: string | null = null;
  const { data: obj } = await db.from("scale_objectives").select("id").eq("template_key", "cendr_start").maybeSingle();
  if (obj) objectiveId = obj.id as string;
  else {
    const { data: hasFocus } = await db.from("scale_objectives").select("id").eq("is_focus", true).is("archived_at", null).maybeSingle();
    const { data: made } = await db
      .from("scale_objectives")
      .insert({ title: plan.objective.title, description: plan.objective.description, metric: plan.objective.metric, kind: "validation", is_focus: !hasFocus, template_key: "cendr_start", created_by: userId })
      .select("id")
      .single();
    objectiveId = (made?.id as string) ?? null;
  }

  let order = 0;
  for (const p of plan.projects) {
    order += 1;
    if (done.has(p.key)) continue;
    const { data: project, error } = await db
      .from("scale_projects")
      .insert({ title: p.title, outcome: p.outcome, success_criterion: p.success_criterion, axis: p.axis, horizon: p.horizon, status: p.horizon === "now" ? "active" : "planned", objective_id: p.objective ? objectiveId : null, template_key: p.key, sort_order: order, created_by: userId })
      .select("id")
      .single();
    if (error || !project) return false;
    const projectId = project.id as string;
    if (p.tasks.length) {
      await db.from("scale_tasks").insert(p.tasks.map((title, i) => ({ title, project_id: projectId, status: "todo", sort_order: i + 1, created_by: userId })));
    }
    for (const key of p.tests) {
      const tt = testTemplate(key, locale);
      await db.from("scale_tests").insert({ title: tt.title, category: tt.category, protocol: tt.protocol, metrics: tt.metrics, template_key: key, project_id: projectId, objective_id: p.objective ? objectiveId : null, created_by: userId });
    }
    for (const key of p.docs) {
      const d = docTemplate(key, locale);
      await db.from("scale_documents").insert({ title: d.title, content: d.content, template_key: key, project_id: projectId, created_by: userId, updated_by: userId });
    }
  }
  const { data: vision } = await db.from("scale_documents").select("id").eq("template_key", "vision").maybeSingle();
  if (!vision) {
    const d = docTemplate("vision", locale);
    await db.from("scale_documents").insert({ title: d.title, content: d.content, template_key: "vision", created_by: userId, updated_by: userId });
  }
  const { data: metrics } = await db.from("scale_metrics").select("template_key").not("template_key", "is", null);
  const haveMetrics = new Set((metrics ?? []).map((m) => m.template_key as string));
  const toAdd = metricSuggestions(locale).filter((m) => !haveMetrics.has(m.key));
  if (toAdd.length) {
    await db.from("scale_metrics").insert(toAdd.map((m, i) => ({ name: m.name, definition: m.definition, unit: m.unit, period: m.period, source: m.source, template_key: m.key, sort_order: i + 1, created_by: userId })));
  }
  const { data: review } = await db.from("scale_tasks").select("id").eq("recurrence", "weekly").eq("kind", "task").ilike("title", plan.weeklyReview).maybeSingle();
  if (!review) {
    const today = todayIso();
    let friday = addDays(weekStart(today), 4);
    if (friday < today) friday = addDays(friday, 7);
    await db.from("scale_tasks").insert({ title: plan.weeklyReview, status: "todo", recurrence: "weekly", due_date: friday, estimate_hours: 0.5, created_by: userId });
  }
  return true;
}

/** Adds the suggested indicators (definitions only: values stay "not filled in" until typed). */
export async function addSuggestedMetrics(): Promise<ScaleResult<Row[]>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const { data: metrics } = await t.db.from("scale_metrics").select("template_key").not("template_key", "is", null);
  const have = new Set((metrics ?? []).map((m) => m.template_key as string));
  const toAdd = metricSuggestions(locale).filter((m) => !have.has(m.key));
  if (!toAdd.length) return { ok: true, data: [] };
  const { data, error } = await t.db
    .from("scale_metrics")
    .insert(toAdd.map((m, i) => ({ name: m.name, definition: m.definition, unit: m.unit, period: m.period, source: m.source, template_key: m.key, sort_order: 100 + i, created_by: t.userId })))
    .select("*");
  if (error) return fail("unknown");
  return { ok: true, data: (data ?? []) as Row[] };
}

export async function createTestFromTemplate(key: string, projectId: string | null): Promise<ScaleResult<Row>> {
  if (!(TEST_TEMPLATES as readonly string[]).includes(key)) return fail("validation");
  const tt = testTemplate(key as (typeof TEST_TEMPLATES)[number], (await getLocale()) === "en" ? "en" : "fr");
  return createRecord("test", { title: tt.title, category: tt.category, protocol: tt.protocol, metrics: tt.metrics, template_key: key, ...(projectId ? { project_id: projectId } : {}) });
}

export async function saveView(values: Record<string, unknown>): Promise<ScaleResult<Row>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = viewSchema.safeParse(values);
  if (!parsed.success) return fail("validation");
  const { data, error } = await t.db.from("scale_saved_views").insert({ ...parsed.data, owner_id: t.userId }).select("*").single();
  if (error || !data) return fail("unknown");
  return { ok: true, data: data as Row };
}

export async function deleteView(id: string): Promise<ScaleResult<{ id: string }>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!z.uuid().safeParse(id).success) return fail("validation");
  await t.db.from("scale_saved_views").delete().eq("id", id);
  return { ok: true, data: { id } };
}

// ─── Documents ──────────────────────────────────────────────────────────────

export async function getDocument(id: string): Promise<ScaleResult<ScaleDocument>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!z.uuid().safeParse(id).success) return fail("validation");
  const { data } = await t.db.from("scale_documents").select("*").eq("id", id).maybeSingle();
  return data ? { ok: true, data: data as ScaleDocument } : fail("not_found");
}

/** Autosave. If someone else saved in between, nothing is overwritten: their version is returned. */
export async function saveDocument(id: string, values: { title?: string; content?: Block[] }, expectedUpdatedAt: string): Promise<ScaleResult<ScaleDocument>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = z.strictObject({ title: z.string().trim().min(1).max(200).optional(), content: blocksSchema.optional() }).safeParse(values);
  if (!parsed.success || !z.uuid().safeParse(id).success) return fail("validation");
  const { data, error } = await t.db
    .from("scale_documents")
    .update({ ...parsed.data, updated_by: t.userId })
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error) return fail(error.code === "23514" ? "validation" : "unknown");
  if (!data) {
    const { data: current } = await t.db.from("scale_documents").select("*").eq("id", id).maybeSingle();
    return current ? fail("conflict", current) : fail("not_found");
  }
  return { ok: true, data: data as ScaleDocument };
}

// ─── Search (our team's Scale data only, and customer company names) ────────

export type SearchHit = { type: "objective" | "project" | "milestone" | "task" | "test" | "document" | "decision" | "company"; id: string; title: string; detail: string | null; archived: boolean };

export async function searchScale(query: string): Promise<ScaleResult<SearchHit[]>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const q = query.normalize("NFC").replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);
  if (q.length < 2) return { ok: true, data: [] };
  const like = `%${q}%`;
  const [objectives, projects, milestones, tasks, tests, decisions, documents, companies] = await Promise.all([
    t.db.from("scale_objectives").select("id, title, description, archived_at").or(`title.ilike.${like},description.ilike.${like},metric.ilike.${like}`).limit(8),
    t.db.from("scale_projects").select("id, title, outcome, archived_at").or(`title.ilike.${like},outcome.ilike.${like},description.ilike.${like},next_action.ilike.${like}`).limit(8),
    t.db.from("scale_milestones").select("id, title, project_id, archived_at").ilike("title", like).limit(8),
    t.db.from("scale_tasks").select("id, title, description, archived_at").or(`title.ilike.${like},description.ilike.${like}`).limit(12),
    t.db.from("scale_tests").select("id, title, hypothesis, archived_at").or(`title.ilike.${like},hypothesis.ilike.${like},results.ilike.${like},conclusion_note.ilike.${like}`).limit(8),
    t.db.from("scale_decisions").select("id, subject, choice, archived_at").or(`subject.ilike.${like},choice.ilike.${like},reasons.ilike.${like}`).limit(8),
    t.db.from("scale_documents").select("id, title, content, archived_at"),
    t.db.rpc("platform_list_companies"),
  ]);
  const needle = q.toLocaleLowerCase();
  const short = (s: unknown) => (typeof s === "string" && s ? s.replace(/\s+/g, " ").slice(0, 120) : null);
  const docHits = (documents.data ?? [])
    .map((d) => {
      const body = blocksText((d.content ?? []) as Block[]);
      const inTitle = String(d.title).toLocaleLowerCase().includes(needle);
      const at = body.toLocaleLowerCase().indexOf(needle);
      if (!inTitle && at < 0) return null;
      return { type: "document" as const, id: d.id as string, title: d.title as string, detail: at >= 0 ? short(body.slice(Math.max(0, at - 30), at + 90)) : null, archived: Boolean(d.archived_at) };
    })
    .filter((h): h is NonNullable<typeof h> => Boolean(h))
    .slice(0, 8);
  const hits: SearchHit[] = [
    ...(projects.data ?? []).map((r) => ({ type: "project" as const, id: r.id as string, title: r.title as string, detail: short(r.outcome), archived: Boolean(r.archived_at) })),
    ...(tasks.data ?? []).map((r) => ({ type: "task" as const, id: r.id as string, title: r.title as string, detail: short(r.description), archived: Boolean(r.archived_at) })),
    ...(tests.data ?? []).map((r) => ({ type: "test" as const, id: r.id as string, title: r.title as string, detail: short(r.hypothesis), archived: Boolean(r.archived_at) })),
    ...docHits,
    ...(objectives.data ?? []).map((r) => ({ type: "objective" as const, id: r.id as string, title: r.title as string, detail: short(r.description), archived: Boolean(r.archived_at) })),
    ...(decisions.data ?? []).map((r) => ({ type: "decision" as const, id: r.id as string, title: r.subject as string, detail: short(r.choice), archived: Boolean(r.archived_at) })),
    ...(milestones.data ?? []).map((r) => ({ type: "milestone" as const, id: r.id as string, title: r.title as string, detail: null, archived: Boolean(r.archived_at) })),
    ...((companies.data ?? []) as { id: string; name: string; plan_name: string | null }[])
      .filter((c) => c.name.toLocaleLowerCase().includes(needle))
      .slice(0, 6)
      .map((c) => ({ type: "company" as const, id: c.id, title: c.name, detail: c.plan_name, archived: false })),
  ];
  return { ok: true, data: hits };
}
