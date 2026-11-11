import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  CATEGORY_COLUMNS,
  DOCUMENT_META,
  MILESTONE_COLUMNS,
  TASK_COLUMNS,
  type Category,
  type DocumentMeta,
  type Milestone,
  type StudioSnapshot,
  type Task,
} from "../types";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Everything Studio shows, in one read (our team's data is small; documents' text is read when one
 * opens). Row Level Security lets only platform admins read these tables; callers checked it already.
 */
export async function getStudioSnapshot(ctx: AppContext, client?: Client): Promise<StudioSnapshot> {
  const supabase = client ?? (await createClient());
  const [tasks, milestones, categories, documents, taskDocuments, milestoneDocuments, visits] = await Promise.all([
    supabase.from("scale_tasks").select(TASK_COLUMNS).is("archived_at", null).neq("status", "cancelled").order("sort_order").order("created_at"),
    supabase.from("scale_milestones").select(MILESTONE_COLUMNS).order("target_date", { nullsFirst: false }).order("sort_order").order("created_at"),
    supabase.from("scale_categories").select(CATEGORY_COLUMNS).order("sort_order").order("created_at"),
    supabase.from("scale_documents").select(DOCUMENT_META).order("updated_at", { ascending: false }),
    supabase.from("scale_task_documents").select("task_id, document_id"),
    supabase.from("scale_milestone_documents").select("milestone_id, document_id"),
    supabase.from("scale_document_visits").select("document_id, opened_at").eq("user_id", ctx.user.id).order("opened_at", { ascending: false }).limit(20),
  ]);
  return {
    tasks: (tasks.data ?? []) as Task[],
    milestones: (milestones.data ?? []) as Milestone[],
    categories: (categories.data ?? []) as Category[],
    documents: (documents.data ?? []) as DocumentMeta[],
    taskDocuments: taskDocuments.data ?? [],
    milestoneDocuments: milestoneDocuments.data ?? [],
    visits: visits.data ?? [],
    me: { id: ctx.user.id, firstName: ctx.profile.fullName?.trim().split(/\s+/)[0] ?? null },
    loadedAt: Date.now(),
  };
}
