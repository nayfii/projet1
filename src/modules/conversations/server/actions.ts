"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { getCompanyModels } from "@/modules/providers/server/models";
import { MODEL_CHOICE_AUTO } from "@/modules/providers/catalog";
import { listConversations } from "./queries";

const choiceSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,62}$/);

/** A model choice is valid if the company allows it (Auto only when enabled). */
async function isValidChoice(companyId: string, choice: string): Promise<boolean> {
  const models = await getCompanyModels(companyId);
  return choice === MODEL_CHOICE_AUTO ? models.autoEnabled : models.allowed.some((m) => m.id === choice);
}

export async function createConversationAction(input: { clientId?: string | null; modelChoice: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ clientId: z.uuid().nullish(), modelChoice: choiceSchema }).safeParse(input);
  if (!parsed.success || !(await isValidChoice(ctx.active.companyId, parsed.data.modelChoice))) {
    return { ok: false, error: "validation" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ company_id: ctx.active.companyId, client_id: parsed.data.clientId ?? null, model_choice: parsed.data.modelChoice })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: toErrorCode(error) };
  return { ok: true, data: { id: data.id } };
}

export async function renameConversationAction(input: { conversationId: string; title: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid(), title: z.string().trim().min(1).max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("conversations")
    // Renamed by hand: automatic titles stop for this conversation.
    .update({ title: parsed.data.title, title_auto: false }, { count: "exact" })
    .eq("id", parsed.data.conversationId);
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!count) return { ok: false, error: "not_found" };
  revalidatePath("/chat", "layout");
  return { ok: true };
}

export async function setConversationClientAction(input: { conversationId: string; clientId: string | null }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid(), clientId: z.uuid().nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  // RLS refuses a client the user cannot access, and the foreign key a client of another company.
  const { error, count } = await supabase
    .from("conversations")
    .update({ client_id: parsed.data.clientId }, { count: "exact" })
    .eq("id", parsed.data.conversationId);
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!count) return { ok: false, error: "not_found" };
  revalidatePath("/chat", "layout");
  return { ok: true };
}

export async function setConversationModelAction(input: { conversationId: string; modelChoice: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid(), modelChoice: choiceSchema }).safeParse(input);
  if (!parsed.success || !(await isValidChoice(ctx.active.companyId, parsed.data.modelChoice))) {
    return { ok: false, error: "validation" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ model_choice: parsed.data.modelChoice })
    .eq("id", parsed.data.conversationId);
  if (error) return { ok: false, error: toErrorCode(error) };
  return { ok: true };
}

export async function deleteConversationAction(input: { conversationId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  // Files first (Storage keeps objects otherwise), then the conversation (messages cascade).
  const { data: files } = await supabase
    .from("conversation_attachments")
    .select("storage_path, bucket")
    .eq("conversation_id", parsed.data.conversationId);
  for (const bucket of ["chat-attachments", "render-media"]) {
    const paths = (files ?? []).filter((f) => f.bucket === bucket).map((f) => f.storage_path);
    if (paths.length) await supabase.storage.from(bucket).remove(paths);
  }
  // Videos made by the render worker (Step 8).
  const { data: jobs } = await supabase.from("render_jobs").select("outputs").eq("conversation_id", parsed.data.conversationId);
  const outputs = (jobs ?? []).flatMap((j) => ((j.outputs as { path?: string }[] | null) ?? []).flatMap((o) => (o.path ? [o.path] : [])));
  if (outputs.length) await supabase.storage.from("render-outputs").remove(outputs);
  const { error, count } = await supabase
    .from("conversations")
    .delete({ count: "exact" })
    .eq("id", parsed.data.conversationId);
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!count) return { ok: false, error: "not_found" };
  revalidatePath("/chat", "layout");
  return { ok: true };
}

export async function removePendingAttachmentAction(input: { attachmentId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ attachmentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversation_attachments")
    .delete()
    .eq("id", parsed.data.attachmentId)
    .is("message_id", null)
    .select("storage_path, bucket")
    .maybeSingle();
  if (!data) return { ok: false, error: "not_found" };
  await supabase.storage.from(data.bucket).remove([data.storage_path]);
  return { ok: true };
}

export type SearchHit = { conversationId: string; title: string | null; clientId: string | null; snippet: string | null; matchedAt: string | null };

export async function searchConversationsAction(query: string): Promise<SearchHit[]> {
  const ctx = await memberOrNull();
  const q = query.trim().slice(0, 200);
  if (!ctx || q.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("search_conversations", { p_company: ctx.active.companyId, p_query: q, p_limit: 20 });
  return (data ?? []).map((r) => ({
    conversationId: r.conversation_id,
    title: r.title,
    clientId: r.client_id,
    snippet: r.snippet,
    matchedAt: r.matched_at,
  }));
}

/** The sidebar's recent conversations, reloaded when a colleague adds this person to one. */
export async function loadConversationListAction() {
  const ctx = await memberOrNull();
  if (!ctx) return null;
  return listConversations(ctx.active.companyId, { limit: 30, meId: ctx.user.id });
}

/** "Do not feed the memory": no automatic client memory from this conversation (CLAUDE.md §11). Owner only (RLS). */
export async function setConversationFeedMemoryAction(input: { conversationId: string; feed: boolean }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid(), feed: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { data, error } = await (await createClient())
    .from("conversations")
    .update({ feed_memory: parsed.data.feed })
    .eq("id", parsed.data.conversationId)
    .select("id");
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!data?.length) return { ok: false, error: "owner_only" };
  return { ok: true };
}

/** Pin a conversation at the top of one's own sidebar (or unpin it). */
export async function setConversationPinnedAction(input: { conversationId: string; pinned: boolean }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  const parsed = z.object({ conversationId: z.uuid(), pinned: z.boolean() }).safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("set_conversation_pinned", { p_conversation: parsed.data.conversationId, p_pinned: parsed.data.pinned });
  return error ? { ok: false, error: toErrorCode(error) } : { ok: true };
}

/** Archive a conversation for oneself (out of the recent list, still searchable), or bring it back. */
export async function setConversationArchivedAction(input: { conversationId: string; archived: boolean }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  const parsed = z.object({ conversationId: z.uuid(), archived: z.boolean() }).safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("set_conversation_archived", { p_conversation: parsed.data.conversationId, p_archived: parsed.data.archived });
  return error ? { ok: false, error: toErrorCode(error) } : { ok: true };
}

/** Edit an earlier prompt: it and what follows are set aside; the edited text is then sent as usual. */
export async function rewindConversationAction(input: { messageId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  const parsed = z.object({ messageId: z.uuid() }).safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("rewind_conversation", { p_message: parsed.data.messageId });
  return error ? { ok: false, error: toErrorCode(error) } : { ok: true };
}

/** Conversations of this person where an answer is still being written (the server finishes it even after leaving). */
export async function generatingConversationsAction(): Promise<string[]> {
  const ctx = await memberOrNull();
  if (!ctx) return [];
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data } = await (await createClient())
    .from("messages")
    .select("conversation_id")
    .eq("company_id", ctx.active.companyId)
    .eq("status", "streaming")
    .gte("created_at", since)
    .limit(50);
  return [...new Set((data ?? []).map((m) => m.conversation_id))];
}
