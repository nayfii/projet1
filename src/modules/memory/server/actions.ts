"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { parseModelJson } from "../json";
import { AUTO_CLIENT_MEMORY_SYSTEM, PROMOTE_SYSTEM, runMemoryTask, SUGGEST_ENTRIES_SYSTEM, type MemoryTaskError } from "./ai-tasks";
import { indexEntry } from "./indexer";
import { myMemorySpaces } from "./retrieval";
import { PLACEHOLDER_PATTERN } from "@/modules/hide/categories";
import { autoSpans, restorePlaceholders } from "@/modules/hide/mask";
import { hideConfigured } from "@/modules/hide/server/crypto";
import { conversationValues, createEphemeralMasker, getHideSettings, loadDetectionLists } from "@/modules/hide/server/masker";

const entrySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
});

function revalidateMemory(spaceId?: string) {
  revalidatePath("/memory");
  if (spaceId) revalidatePath(`/memory/${spaceId}`);
}

/** Deliberate creation only: typed by a person, or saved from a chat message by a person. */
export async function createEntryAction(input: {
  spaceId: string;
  title: string;
  content: string;
  source?: { conversationId: string; messageId: string };
}): Promise<ActionResult<{ id: string; indexed: boolean }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = entrySchema
    .extend({ spaceId: z.uuid(), source: z.object({ conversationId: z.uuid(), messageId: z.uuid() }).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  if (parsed.data.source) {
    // The message must be one the user can see (RLS).
    const { data: message } = await supabase
      .from("messages")
      .select("id")
      .eq("id", parsed.data.source.messageId)
      .eq("conversation_id", parsed.data.source.conversationId)
      .maybeSingle();
    if (!message) return { ok: false, error: "not_found" };
  }
  const { data, error } = await supabase
    .from("memory_entries")
    .insert({
      space_id: parsed.data.spaceId,
      title: parsed.data.title,
      content: parsed.data.content,
      source_type: parsed.data.source ? "chat" : "manual",
      source_ref: parsed.data.source ? { conversation_id: parsed.data.source.conversationId, message_id: parsed.data.source.messageId } : {},
    })
    .select("id, title, content")
    .single();
  if (error || !data) return { ok: false, error: toErrorCode(error) };
  const indexed = await indexEntry(supabase, ctx, data);
  revalidateMemory(parsed.data.spaceId);
  return { ok: true, data: { id: data.id, indexed } };
}

export async function updateEntryAction(input: { entryId: string; title: string; content: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = entrySchema.extend({ entryId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memory_entries")
    .update({ title: parsed.data.title, content: parsed.data.content })
    .eq("id", parsed.data.entryId)
    .select("id, title, content, space_id")
    .maybeSingle();
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!data) return { ok: false, error: "not_found" };
  await indexEntry(supabase, ctx, data);
  revalidateMemory(data.space_id);
  return { ok: true };
}

export async function deleteEntryAction(input: { entryId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ entryId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("memory_entries").delete().eq("id", parsed.data.entryId).select("space_id").maybeSingle();
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!data) return { ok: false, error: "not_found" };
  revalidateMemory(data.space_id);
  return { ok: true };
}

export async function deleteDocumentAction(input: { documentId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ documentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("storage_path, space_id").eq("id", parsed.data.documentId).maybeSingle();
  if (!doc) return { ok: false, error: "not_found" };
  const { error, count } = await supabase.from("documents").delete({ count: "exact" }).eq("id", parsed.data.documentId);
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!count) return { ok: false, error: "forbidden" };
  await supabase.storage.from("memory-documents").remove([doc.storage_path]);
  revalidateMemory(doc.space_id);
  return { ok: true };
}

/** A person with write rights approves (possibly edited) or rejects an AI suggestion. */
export async function decideSuggestionAction(input: {
  suggestionId: string;
  approve: boolean;
  title?: string;
  content?: string;
}): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ suggestionId: z.uuid(), approve: z.boolean(), title: z.string().trim().max(200).optional(), content: z.string().trim().max(20_000).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: entryId, error } = await supabase.rpc("decide_memory_suggestion", {
    p_suggestion: parsed.data.suggestionId,
    p_approve: parsed.data.approve,
    p_title: parsed.data.title,
    p_content: parsed.data.content,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  if (entryId) {
    const { data: entry } = await supabase.from("memory_entries").select("id, title, content, space_id").eq("id", entryId).maybeSingle();
    if (entry) {
      await indexEntry(supabase, ctx, entry);
      revalidateMemory(entry.space_id);
    }
  }
  revalidateMemory();
  return { ok: true };
}

export type SuggestionResult = { ok: true; suggestions: { id: string; title: string; content: string; spaceId: string }[] } | { ok: false; error: MemoryTaskError | "forbidden" | "not_found" | "no_target" };

/**
 * "Propose memory entries": the AI reads the conversation and proposes entries for a memory the user can
 * write (the conversation's client memory, else the company memory). Nothing is saved until approved.
 */
export async function suggestFromConversationAction(input: { conversationId: string }): Promise<SuggestionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, client_id, model_choice")
    .eq("id", parsed.data.conversationId)
    // The company being worked in: its memory and its credits (someone may belong to several companies).
    .eq("company_id", ctx.active.companyId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: "not_found" };

  const spaces = await myMemorySpaces(supabase, ctx.active.companyId);
  const target =
    (conversation.client_id ? spaces.find((s) => s.clientId === conversation.client_id && s.canWrite) : undefined) ??
    spaces.find((s) => s.kind === "company" && s.canWrite);
  if (!target) return { ok: false, error: "no_target" };

  const { data: messages } = await supabase
    .from("messages")
    .select("author_type, content, masked_content, status")
    .eq("conversation_id", conversation.id)
    .is("superseded_at", null)
    .order("seq");
  const transcript = (messages ?? [])
    .filter((m) => m.content && m.status !== "error")
    // Hide: the AI reads the conversation as the chat models received it (with placeholders).
    .map((m) => `${m.author_type === "assistant" ? "Assistant" : "User"}: ${m.masked_content ?? m.content}`)
    .join("\n\n")
    .slice(-24_000);
  if (!transcript) return { ok: true, suggestions: [] };

  const result = await runMemoryTask(supabase, ctx, { system: SUGGEST_ENTRIES_SYSTEM, user: transcript, modelChoice: conversation.model_choice });
  if (!result.ok) return { ok: false, error: result.error };
  const items = parseModelJson(result.text);
  // Placeholders in the proposals are turned back into real values for the person who reviews them.
  const masked = (messages ?? []).some((m) => m.masked_content !== null);
  const values = masked && hideConfigured() ? await conversationValues(conversation.id, [transcript]) : new Map<string, string>();
  const valid = (Array.isArray(items) ? items : [])
    .map((i) =>
      entrySchema.safeParse({
        title: restorePlaceholders(String((i as { title?: unknown }).title ?? ""), values).slice(0, 200),
        content: restorePlaceholders(String((i as { content?: unknown }).content ?? ""), values),
      }),
    )
    .filter((r) => r.success)
    .map((r) => r.data!)
    .slice(0, 5);
  if (valid.length === 0) return { ok: true, suggestions: [] };

  const { data: rows, error } = await supabase
    .from("memory_suggestions")
    .insert(valid.map((v) => ({ space_id: target.spaceId, kind: "new_entry", title: v.title, content: v.content, source_ref: { conversation_id: conversation.id } })))
    .select("id, title, content, space_id");
  if (error) return { ok: false, error: "provider_error" };
  revalidateMemory(target.spaceId);
  return { ok: true, suggestions: (rows ?? []).map((r) => ({ id: r.id, title: r.title, content: r.content, spaceId: r.space_id })) };
}

/**
 * "Propose for company memory": the AI rewrites a client note into a general learning without
 * client-identifying details. It becomes a pending suggestion that a company-memory writer approves.
 */
export async function proposePromotionAction(input: { entryId: string }): Promise<{ ok: true; proposed: boolean } | { ok: false; error: MemoryTaskError | "forbidden" | "not_found" }> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ entryId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const supabase = await createClient();
  const { data: entry } = await supabase.from("memory_entries").select("id, title, content, space_id").eq("id", parsed.data.entryId).maybeSingle();
  if (!entry) return { ok: false, error: "not_found" };
  const spaces = await myMemorySpaces(supabase, ctx.active.companyId);
  const source = spaces.find((s) => s.spaceId === entry.space_id);
  const company = spaces.find((s) => s.kind === "company");
  if (!source || source.kind !== "client" || !company) return { ok: false, error: "forbidden" };

  // Hide: with Automatic on by default, the note is masked before it goes to the AI.
  const note = `Client note\nTitle: ${entry.title}\n${entry.content}`;
  const settings = await getHideSettings(supabase, ctx.active.companyId);
  let user = note;
  if (settings.defaultModes.includes("automatic")) {
    const masker = createEphemeralMasker(await loadDetectionLists(supabase, ctx));
    [{ masked: user }] = await masker.mask([{ text: note, spans: autoSpans(masker.detect(note), new Set(settings.autoCategories)) }]);
  }
  const result = await runMemoryTask(supabase, ctx, { system: PROMOTE_SYSTEM, user });
  if (!result.ok) return { ok: false, error: result.error };
  const json = parseModelJson(result.text) as { general?: unknown; title?: unknown; content?: unknown } | null;
  const proposal = entrySchema.safeParse({ title: String(json?.title ?? "").slice(0, 200), content: String(json?.content ?? "") });
  // A placeholder left in the proposal means it still points at something specific: not a general learning.
  const specific = new RegExp(PLACEHOLDER_PATTERN.source).test(`${proposal.data?.title ?? ""} ${proposal.data?.content ?? ""}`);
  if (!json || json.general !== true || !proposal.success || specific) return { ok: true, proposed: false };

  const { error } = await supabase.from("memory_suggestions").insert({
    space_id: company.spaceId,
    kind: "promotion",
    title: proposal.data.title,
    content: proposal.data.content,
    source_space_id: entry.space_id,
    source_ref: { entry_id: entry.id },
  });
  if (error) return { ok: false, error: "provider_error" };
  revalidateMemory(company.spaceId);
  return { ok: true, proposed: true };
}

export type AutoMemoryResult = { entries: { id: string; title: string }[]; clientName: string; spaceId: string } | null;

/**
 * Client memory fed automatically (CLAUDE.md §11): after an answer in a conversation linked to a
 * client, the AI keeps the useful facts about that client — the facts only, never the conversation —
 * when the person may write in its memory, the company has not switched it off and the conversation
 * is not marked "do not feed the memory". Each entry says it was added automatically, and can be undone.
 */
export async function autoClientMemoryAction(input: { conversationId: string; messageId: string }): Promise<AutoMemoryResult> {
  const ctx = await memberOrNull();
  if (!ctx) return null;
  const parsed = z.object({ conversationId: z.uuid(), messageId: z.uuid() }).safeParse(input);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const [{ data: conversation }, { data: settings }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, client_id, model_choice, feed_memory, client:clients(name)")
      .eq("id", parsed.data.conversationId)
      .eq("company_id", ctx.active.companyId)
      .maybeSingle(),
    supabase.from("company_ai_settings").select("auto_client_memory").eq("company_id", ctx.active.companyId).maybeSingle(),
  ]);
  if (!conversation?.client_id || !conversation.feed_memory || settings?.auto_client_memory === false) return null;
  const space = (await myMemorySpaces(supabase, ctx.active.companyId)).find((s) => s.clientId === conversation.client_id && s.canWrite);
  if (!space) return null;

  // Once per answer, and only for a complete answer this person can see (RLS).
  const { data: answer } = await supabase
    .from("messages")
    .select("seq, content, masked_content, status, author_type")
    .eq("id", parsed.data.messageId)
    .eq("conversation_id", conversation.id)
    .maybeSingle();
  if (!answer || answer.author_type !== "assistant" || answer.status !== "complete" || !answer.content) return null;
  const { data: already } = await supabase
    .from("memory_entries")
    .select("id")
    .eq("space_id", space.spaceId)
    .eq("source_ref->>message_id", parsed.data.messageId)
    .limit(1);
  if (already?.length) return null;
  const { data: question } = await supabase
    .from("messages")
    .select("content, masked_content")
    .eq("conversation_id", conversation.id)
    .eq("author_type", "user")
    .lt("seq", answer.seq)
    .is("superseded_at", null)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  const clientName = conversation.client?.name ?? "";
  // As the chat model received it (Hide placeholders), then real values restored for the memory.
  const exchange = [`User: ${question?.masked_content ?? question?.content ?? ""}`, `Assistant: ${answer.masked_content ?? answer.content}`].join("\n\n").slice(-12_000);
  const result = await runMemoryTask(supabase, ctx, {
    system: AUTO_CLIENT_MEMORY_SYSTEM.replace("{CLIENT}", clientName),
    user: exchange,
    modelChoice: conversation.model_choice,
  });
  if (!result.ok) return null;
  const items = parseModelJson(result.text);
  const masked = answer.masked_content !== null || question?.masked_content != null;
  const values = masked && hideConfigured() ? await conversationValues(conversation.id, [exchange]) : new Map<string, string>();
  const valid = (Array.isArray(items) ? items : [])
    .map((i) =>
      entrySchema.safeParse({
        title: restorePlaceholders(String((i as { title?: unknown }).title ?? ""), values).slice(0, 200),
        content: restorePlaceholders(String((i as { content?: unknown }).content ?? ""), values),
      }),
    )
    .filter((r) => r.success)
    .map((r) => r.data!)
    // Nothing that still carries a placeholder (a value this person was not shown).
    .filter((e) => !new RegExp(PLACEHOLDER_PATTERN.source).test(`${e.title}\n${e.content}`))
    .slice(0, 3);
  if (valid.length === 0) return null;
  const { data: created, error } = await supabase
    .from("memory_entries")
    .insert(
      valid.map((e) => ({
        space_id: space.spaceId,
        title: e.title,
        content: e.content,
        source_type: "auto",
        source_ref: { conversation_id: conversation.id, message_id: parsed.data.messageId },
      })),
    )
    .select("id, title, content");
  if (error || !created) return null;
  for (const entry of created) await indexEntry(supabase, ctx, entry);
  revalidateMemory(space.spaceId);
  return { entries: created.map((e) => ({ id: e.id, title: e.title })), clientName, spaceId: space.spaceId };
}

/** "Undo" right after an automatic addition: the entries are deleted (the person wrote them). */
export async function undoAutoMemoryAction(input: { entryIds: string[] }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ entryIds: z.array(z.uuid()).min(1).max(5) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("memory_entries")
    .delete()
    .in("id", parsed.data.entryIds)
    .eq("source_type", "auto")
    .eq("author_id", ctx.user.id);
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidateMemory();
  return { ok: true };
}
