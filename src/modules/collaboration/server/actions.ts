"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { getTimelineMessages } from "@/modules/conversations/server/queries";
import { draftClientHandover, draftConversationHandover, HANDOVER_SECTIONS } from "./handover";
import { getConversationPeople } from "./queries";

/** Adds colleagues to a conversation. `fromSeq`: first message they will see (null = from now). Re-checked in SQL. */
export async function addParticipantsAction(input: { conversationId: string; userIds: string[]; fromSeq: number | null }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ conversationId: z.uuid(), userIds: z.array(z.uuid()).min(1).max(20), fromSeq: z.number().int().min(1).nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_conversation_participants", {
    p_conversation: parsed.data.conversationId,
    p_users: parsed.data.userIds,
    p_from_seq: parsed.data.fromSeq ?? undefined,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  return { ok: true };
}

export async function leaveConversationAction(input: { conversationId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("leave_conversation", { p_conversation: parsed.data.conversationId });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/chat", "layout");
  return { ok: true };
}

/**
 * Gives the conversation to a colleague, with a handover file drafted by the AI (the transfer happens
 * even if the AI cannot draft it: the recipient then writes it). The sender loses access.
 */
export async function transferConversationAction(input: { conversationId: string; toUserId: string }): Promise<ActionResult<{ aiGenerated: boolean }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid(), toUserId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: conversation } = await supabase.from("conversations").select("owner_id").eq("id", parsed.data.conversationId).maybeSingle();
  if (!conversation) return { ok: false, error: "not_found" };
  if (conversation.owner_id !== ctx.user.id) return { ok: false, error: "owner_only" };

  const sections = await draftConversationHandover(supabase, ctx, parsed.data.conversationId);
  const { error } = await supabase.rpc("transfer_conversation", {
    p_conversation: parsed.data.conversationId,
    p_to: parsed.data.toUserId,
    p_sections: sections ?? {},
    p_ai_generated: sections !== null,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/chat", "layout");
  return { ok: true, data: { aiGenerated: sections !== null } };
}

/** Hands a restricted client over to a colleague (assignment, own conversations about it, handover file). */
export async function transferClientAction(input: { clientId: string; toUserId: string }): Promise<ActionResult<{ aiGenerated: boolean }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ clientId: z.uuid(), toUserId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: assigned } = await supabase
    .from("client_assignments")
    .select("client_id")
    .eq("client_id", parsed.data.clientId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (!assigned) return { ok: false, error: "not_found" };

  const sections = await draftClientHandover(supabase, ctx, parsed.data.clientId);
  const { error } = await supabase.rpc("transfer_client", {
    p_client: parsed.data.clientId,
    p_to: parsed.data.toUserId,
    p_sections: sections ?? {},
    p_ai_generated: sections !== null,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/clients", "layout");
  revalidatePath("/chat", "layout");
  return { ok: true, data: { aiGenerated: sections !== null } };
}

/** The recipient edits the handover file. */
export async function updateHandoverAction(input: { handoverId: string; sections: Record<string, string> }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const section = z.string().max(8000);
  const parsed = z
    .object({ handoverId: z.uuid(), sections: z.object(Object.fromEntries(HANDOVER_SECTIONS.map((k) => [k, section])) as Record<(typeof HANDOVER_SECTIONS)[number], typeof section>) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("handovers")
    .update({ sections: parsed.data.sections, edited_at: new Date().toISOString() })
    .eq("id", parsed.data.handoverId)
    .select("conversation_id, client_id")
    .maybeSingle();
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!data) return { ok: false, error: "not_found" };
  if (data.conversation_id) revalidatePath(`/chat/${data.conversation_id}`);
  if (data.client_id) revalidatePath(`/clients/${data.client_id}`);
  return { ok: true };
}

/** Real time: messages a colleague posted (or an answer they asked for), as this person may see them. */
export async function loadTimelineMessagesAction(input: { conversationId: string; ids: string[] }) {
  const ctx = await memberOrNull();
  if (!ctx) return [];
  const parsed = z.object({ conversationId: z.uuid(), ids: z.array(z.uuid()).min(1).max(50) }).safeParse(input);
  if (!parsed.success) return [];
  return getTimelineMessages(parsed.data.conversationId, parsed.data.ids);
}

/** Real time: the participants after someone joined or left. */
export async function loadParticipantsAction(input: { conversationId: string }) {
  const ctx = await memberOrNull();
  if (!ctx) return [];
  const parsed = z.object({ conversationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return [];
  return getConversationPeople(parsed.data.conversationId);
}

export type HistoryWarning = { clientName: string | null; userIds: string[] };

/**
 * Before sharing history or transferring: memories cited in the messages the colleagues would see
 * that some of them cannot read (null = the company memory). The person sharing decides.
 */
export async function checkSharedHistoryAction(input: { conversationId: string; userIds: string[]; fromSeq: number | null }): Promise<HistoryWarning[]> {
  const ctx = await memberOrNull();
  if (!ctx) return [];
  const parsed = z
    .object({ conversationId: z.uuid(), userIds: z.array(z.uuid()).min(1).max(20), fromSeq: z.number().int().min(1).nullable() })
    .safeParse(input);
  if (!parsed.success) return [];
  const { data } = await (await createClient()).rpc("history_unreadable_sources", {
    p_conversation: parsed.data.conversationId,
    p_users: parsed.data.userIds,
    p_from_seq: parsed.data.fromSeq ?? 1,
  });
  const bySpace = new Map<string, HistoryWarning>();
  for (const row of data ?? []) {
    const warning = bySpace.get(row.space_id) ?? { clientName: row.client_name, userIds: [] };
    warning.userIds.push(row.user_id);
    bySpace.set(row.space_id, warning);
  }
  return [...bySpace.values()];
}
