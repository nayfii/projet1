"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { blocksSchema, type Block } from "../logic/blocks";
import { isIsoDate, todayIso } from "../logic/dates";
import { snippet } from "../logic/search";
import {
  CATEGORY_COLUMNS,
  CATEGORY_ICONS,
  DOCUMENT_META,
  MILESTONE_COLUMNS,
  MILESTONE_STATUSES,
  PRIORITIES,
  TASK_COLUMNS,
  TASK_STATUSES,
  type Category,
  type ContentHit,
  type DocumentMeta,
  type Milestone,
  type StudioDocument,
  type StudioError,
  type StudioResult,
  type StudioSnapshot,
  type Task,
} from "../types";
import { getStudioSnapshot } from "./queries";

/**
 * Every change made in Studio. Each action checks that the caller is in our team (platform admin);
 * Row Level Security checks it again in the database. Logs hold no content.
 */

type Db = SupabaseClient;

async function team(): Promise<{ db: Db; userId: string } | null> {
  const ctx = await platformAdminOrNull();
  if (!ctx) return null;
  return { db: (await createClient()) as unknown as Db, userId: ctx.user.id };
}

const fail = <T>(error: StudioError, current?: unknown): StudioResult<T> => ({ ok: false, error, current });
const dbError = <T>(code: string | undefined): StudioResult<T> => fail(code === "23503" ? "not_found" : code === "23514" || code === "22P02" || code === "23505" ? "validation" : "unknown");

const id = z.uuid();
const date = z.string().refine(isIsoDate, "date").nullable();
const title = (max: number) => z.string().trim().min(1).max(max);
const text = (max: number) => z.string().max(max).nullable();

export async function refreshStudio(): Promise<StudioResult<StudioSnapshot>> {
  const ctx = await platformAdminOrNull();
  if (!ctx) return fail("forbidden");
  return { ok: true, data: await getStudioSnapshot(ctx) };
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

const taskFields = {
  title: title(300),
  description: text(20_000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  due_date: date,
  category_id: id.nullable(),
  milestone_id: id.nullable(),
  sort_order: z.number().finite(),
};
const taskCreate = z.strictObject({ ...taskFields, title: taskFields.title }).partial().required({ title: true });
const taskPatch = z.strictObject(taskFields).partial();

/** Done tasks keep the moment they were finished (this week's count); reopened ones lose it. */
function completion(patch: Record<string, unknown>): Record<string, unknown> {
  if (patch.status === undefined) return patch;
  return { ...patch, completed_at: patch.status === "done" ? new Date().toISOString() : null };
}

export async function createTask(values: Record<string, unknown>): Promise<StudioResult<Task>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = taskCreate.safeParse(values);
  if (!parsed.success) return fail("validation");
  const { data, error } = await t.db
    .from("scale_tasks")
    .insert({ ...completion(parsed.data), created_by: t.userId })
    .select(TASK_COLUMNS)
    .single();
  return error || !data ? dbError(error?.code) : { ok: true, data: data as Task };
}

export async function updateTask(taskId: string, patch: Record<string, unknown>): Promise<StudioResult<Task>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = taskPatch.safeParse(patch);
  if (!parsed.success || !id.safeParse(taskId).success) return fail("validation");
  const { data, error } = await t.db.from("scale_tasks").update(completion(parsed.data)).eq("id", taskId).select(TASK_COLUMNS).maybeSingle();
  if (error) return dbError(error.code);
  return data ? { ok: true, data: data as Task } : fail("not_found");
}

export async function deleteTask(taskId: string): Promise<StudioResult> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(taskId).success) return fail("validation");
  const { error, count } = await t.db.from("scale_tasks").delete({ count: "exact" }).eq("id", taskId);
  if (error) return dbError(error.code);
  return count ? { ok: true, data: undefined } : fail("not_found");
}

// ─── Milestones ─────────────────────────────────────────────────────────────

const milestoneFields = {
  title: title(200),
  description: text(5000),
  target_date: date,
  status: z.enum(MILESTONE_STATUSES),
  category_id: id.nullable(),
  sort_order: z.number().finite(),
};
const milestoneCreate = z.strictObject(milestoneFields).partial().required({ title: true });
const milestonePatch = z.strictObject(milestoneFields).partial();

function reached(patch: Record<string, unknown>): Record<string, unknown> {
  if (patch.status === undefined) return patch;
  return { ...patch, achieved_date: patch.status === "done" ? todayIso() : null };
}

export async function createMilestone(values: Record<string, unknown>): Promise<StudioResult<Milestone>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = milestoneCreate.safeParse(values);
  if (!parsed.success) return fail("validation");
  const { data, error } = await t.db
    .from("scale_milestones")
    .insert({ ...reached(parsed.data), created_by: t.userId })
    .select(MILESTONE_COLUMNS)
    .single();
  return error || !data ? dbError(error?.code) : { ok: true, data: data as Milestone };
}

export async function updateMilestone(milestoneId: string, patch: Record<string, unknown>): Promise<StudioResult<Milestone>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = milestonePatch.safeParse(patch);
  if (!parsed.success || !id.safeParse(milestoneId).success) return fail("validation");
  const { data, error } = await t.db.from("scale_milestones").update(reached(parsed.data)).eq("id", milestoneId).select(MILESTONE_COLUMNS).maybeSingle();
  if (error) return dbError(error.code);
  return data ? { ok: true, data: data as Milestone } : fail("not_found");
}

export async function archiveMilestone(milestoneId: string, archived: boolean): Promise<StudioResult<Milestone>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(milestoneId).success) return fail("validation");
  const { data, error } = await t.db
    .from("scale_milestones")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", milestoneId)
    .select(MILESTONE_COLUMNS)
    .maybeSingle();
  if (error) return dbError(error.code);
  return data ? { ok: true, data: data as Milestone } : fail("not_found");
}

/** Deleted for good; its tasks stay (without a milestone). */
export async function deleteMilestone(milestoneId: string): Promise<StudioResult> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(milestoneId).success) return fail("validation");
  const { error, count } = await t.db.from("scale_milestones").delete({ count: "exact" }).eq("id", milestoneId);
  if (error) return dbError(error.code);
  return count ? { ok: true, data: undefined } : fail("not_found");
}

// ─── Categories ─────────────────────────────────────────────────────────────

const categoryFields = { name: title(60), icon: z.enum(CATEGORY_ICONS), sort_order: z.number().finite() };

export async function createCategory(values: Record<string, unknown>): Promise<StudioResult<Category>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = z.strictObject(categoryFields).partial().required({ name: true }).safeParse(values);
  if (!parsed.success) return fail("validation");
  const { data, error } = await t.db.from("scale_categories").insert({ ...parsed.data, created_by: t.userId }).select(CATEGORY_COLUMNS).single();
  return error || !data ? dbError(error?.code) : { ok: true, data: data as Category };
}

export async function updateCategory(categoryId: string, patch: Record<string, unknown>): Promise<StudioResult<Category>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = z.strictObject(categoryFields).partial().safeParse(patch);
  if (!parsed.success || !id.safeParse(categoryId).success) return fail("validation");
  const { data, error } = await t.db.from("scale_categories").update(parsed.data).eq("id", categoryId).select(CATEGORY_COLUMNS).maybeSingle();
  if (error) return dbError(error.code);
  return data ? { ok: true, data: data as Category } : fail("not_found");
}

/** The category goes; its documents, tasks and milestones stay, without a category. */
export async function deleteCategory(categoryId: string): Promise<StudioResult> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(categoryId).success) return fail("validation");
  const { error, count } = await t.db.from("scale_categories").delete({ count: "exact" }).eq("id", categoryId);
  if (error) return dbError(error.code);
  return count ? { ok: true, data: undefined } : fail("not_found");
}

// ─── Documents ──────────────────────────────────────────────────────────────

const tags = z.array(z.string().trim().min(1).max(40)).max(20);

export async function createDocument(values: { title: string; category_id?: string | null; content?: Block[] }): Promise<StudioResult<DocumentMeta>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = z.strictObject({ title: title(200), category_id: id.nullable().optional(), content: blocksSchema.optional() }).safeParse(values);
  if (!parsed.success) return fail("validation");
  const { data, error } = await t.db
    .from("scale_documents")
    .insert({ ...parsed.data, created_by: t.userId, updated_by: t.userId })
    .select(DOCUMENT_META)
    .single();
  return error || !data ? dbError(error?.code) : { ok: true, data: data as DocumentMeta };
}

/** One document with its content; the opening is remembered for this person ("Recently opened"). */
export async function openDocument(documentId: string): Promise<StudioResult<StudioDocument>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(documentId).success) return fail("validation");
  const { data } = await t.db.from("scale_documents").select(`${DOCUMENT_META}, content`).eq("id", documentId).maybeSingle();
  if (!data) return fail("not_found");
  await t.db.from("scale_document_visits").upsert({ user_id: t.userId, document_id: documentId, opened_at: new Date().toISOString() });
  return { ok: true, data: data as StudioDocument };
}

/** Autosave. If someone else saved in between, nothing is overwritten: their version comes back. */
export async function saveDocument(documentId: string, values: { title?: string; content?: Block[] }, expectedUpdatedAt: string): Promise<StudioResult<StudioDocument>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = z.strictObject({ title: title(200).optional(), content: blocksSchema.optional() }).safeParse(values);
  if (!parsed.success || !id.safeParse(documentId).success) return fail("validation");
  const { data, error } = await t.db
    .from("scale_documents")
    .update({ ...parsed.data, updated_by: t.userId })
    .eq("id", documentId)
    .eq("updated_at", expectedUpdatedAt)
    .select(`${DOCUMENT_META}, content`)
    .maybeSingle();
  if (error) return dbError(error.code);
  if (!data) {
    const { data: current } = await t.db.from("scale_documents").select(`${DOCUMENT_META}, content`).eq("id", documentId).maybeSingle();
    return current ? fail("conflict", current) : fail("not_found");
  }
  return { ok: true, data: data as StudioDocument };
}

/** Category, tags, pinned, archived: changes that never touch the text being edited. */
export async function updateDocument(documentId: string, patch: Record<string, unknown>): Promise<StudioResult<DocumentMeta>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const parsed = z
    .strictObject({ title: title(200), category_id: id.nullable(), tags, is_pinned: z.boolean(), archived: z.boolean() })
    .partial()
    .safeParse(patch);
  if (!parsed.success || !id.safeParse(documentId).success) return fail("validation");
  const { archived, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest };
  if (archived !== undefined) update.archived_at = archived ? new Date().toISOString() : null;
  const { data, error } = await t.db.from("scale_documents").update(update).eq("id", documentId).select(DOCUMENT_META).maybeSingle();
  if (error) return dbError(error.code);
  return data ? { ok: true, data: data as DocumentMeta } : fail("not_found");
}

export async function duplicateDocument(documentId: string, copySuffix: string): Promise<StudioResult<DocumentMeta>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(documentId).success) return fail("validation");
  const { data: src } = await t.db.from("scale_documents").select("title, category_id, tags, content").eq("id", documentId).maybeSingle();
  if (!src) return fail("not_found");
  // Images are files of their own document: the copy keeps their captions but not the files.
  const content = ((src.content ?? []) as Block[]).filter((b) => b.type !== "image");
  const { data, error } = await t.db
    .from("scale_documents")
    .insert({ title: `${src.title}${copySuffix}`.slice(0, 200), category_id: src.category_id, tags: src.tags, content, created_by: t.userId, updated_by: t.userId })
    .select(DOCUMENT_META)
    .single();
  return error || !data ? dbError(error?.code) : { ok: true, data: data as DocumentMeta };
}

/** Deleted for good, with its images. */
export async function deleteDocument(documentId: string): Promise<StudioResult> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(documentId).success) return fail("validation");
  const { data: files } = await t.db.storage.from("scale-files").list(`doc/${documentId}`, { limit: 1000 });
  if (files?.length) await t.db.storage.from("scale-files").remove(files.map((f) => `doc/${documentId}/${f.name}`));
  const { error, count } = await t.db.from("scale_documents").delete({ count: "exact" }).eq("id", documentId);
  if (error) return dbError(error.code);
  return count ? { ok: true, data: undefined } : fail("not_found");
}

/** Other documents that link to this one. */
export async function documentMentions(documentId: string): Promise<StudioResult<{ id: string; title: string }[]>> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(documentId).success) return fail("validation");
  const { data, error } = await t.db.rpc("studio_document_mentions", { p_document: documentId });
  return error ? dbError(error.code) : { ok: true, data: (data ?? []) as { id: string; title: string }[] };
}

// ─── Links between documents and tasks / milestones ─────────────────────────

export async function linkDocument(kind: "task" | "milestone", ownerId: string, documentId: string, on: boolean): Promise<StudioResult> {
  const t = await team();
  if (!t) return fail("forbidden");
  if (!id.safeParse(ownerId).success || !id.safeParse(documentId).success || (kind !== "task" && kind !== "milestone")) return fail("validation");
  const table = kind === "task" ? "scale_task_documents" : "scale_milestone_documents";
  const key = kind === "task" ? "task_id" : "milestone_id";
  const { error } = on
    ? await t.db.from(table).upsert({ [key]: ownerId, document_id: documentId }, { ignoreDuplicates: true })
    : await t.db.from(table).delete().eq(key, ownerId).eq("document_id", documentId);
  return error ? dbError(error.code) : { ok: true, data: undefined };
}

// ─── Search inside documents ────────────────────────────────────────────────

export async function searchDocuments(query: string): Promise<StudioResult<ContentHit[]>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const q = query.normalize("NFC").trim().slice(0, 100);
  if (q.length < 2) return { ok: true, data: [] };
  const { data, error } = await t.db.rpc("studio_search_documents", { p_query: q, p_limit: 12 });
  if (error) return dbError(error.code);
  return {
    ok: true,
    data: ((data ?? []) as { id: string; title: string; category_id: string | null; score: number; body: string }[]).map((r) => ({
      id: r.id,
      title: r.title,
      categoryId: r.category_id,
      score: r.score,
      snippet: snippet(r.body, q),
    })),
  };
}

// ─── Images in documents ────────────────────────────────────────────────────

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Recognises an image by its first bytes, never by its name or the type the browser claims. */
function sniffImage(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** An image added to a document: stored in our private bucket, under the document. */
export async function uploadImage(form: FormData): Promise<StudioResult<{ path: string }>> {
  const t = await team();
  if (!t) return fail("forbidden");
  const documentId = form.get("document_id");
  const file = form.get("file");
  if (typeof documentId !== "string" || !id.safeParse(documentId).success || !(file instanceof File) || file.size === 0 || file.size > IMAGE_MAX_BYTES) return fail("validation");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return fail("validation");
  const { data: doc } = await t.db.from("scale_documents").select("id").eq("id", documentId).maybeSingle();
  if (!doc) return fail("not_found");
  const path = `doc/${documentId}/${crypto.randomUUID()}.${IMAGE_TYPES[type]}`;
  const { error } = await t.db.storage.from("scale-files").upload(path, bytes, { contentType: type });
  return error ? fail("unknown") : { ok: true, data: { path } };
}
