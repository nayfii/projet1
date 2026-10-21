import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RoutingInfo, SuggestedColleague } from "../stream-events";
import type { AttachmentKind, TimelineMessage } from "../types";
import { isHideMode, type HideCounts, type Span } from "@/modules/hide/categories";
import type { SourceProof } from "@/modules/memory/types";
import { isConfrontation } from "@/modules/confronter/types";

const STALE_STREAM_MS = 5 * 60 * 1000;

/** The signed-in user's conversations (RLS: only those they take part in), most recent first. */
export async function listConversations(companyId: string, { limit = 50, clientId }: { limit?: number; clientId?: string } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("conversations")
    .select("id, title, client_id, model_choice, last_message_at, created_at, client:clients(name)")
    .eq("company_id", companyId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (clientId) query = query.eq("client_id", clientId);
  const { data } = await query;
  return (data ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    clientId: c.client_id,
    clientName: c.client?.name ?? null,
    lastMessageAt: c.last_message_at ?? c.created_at,
  }));
}

export type ConversationListItem = Awaited<ReturnType<typeof listConversations>>[number];

export async function getConversation(conversationId: string) {
  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, company_id, client_id, owner_id, title, model_choice, agent_id, created_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;

  const { rows, messages } = await loadTimeline(supabase, conversationId);

  // Hide modes of the last message sent: the mode control starts from them.
  const lastHideModes = [...rows].reverse().find((r) => r.author_type === "user")?.hide_modes ?? [];
  return { ...conversation, messages, lastHideModes: lastHideModes.filter(isHideMode) };
}

export type ConversationDetail = NonNullable<Awaited<ReturnType<typeof getConversation>>>;

type UserClientLike = Awaited<ReturnType<typeof createClient>>;

/** Timeline messages as the viewer may see them (RLS); `ids`: only these (real-time updates). */
async function loadTimeline(supabase: UserClientLike, conversationId: string, ids?: string[]) {
  const { data: allRows } = await supabase
    .from("messages")
    .select(
      "id, seq, author_type, content, masked_content, hide_counts, hide_modes, hide_spans, status, error_code, created_at, provider, model_id, model_label, routing, context_meta, confrontation, author:profiles!messages_author_id_fkey(id, full_name), attachments:conversation_attachments!conversation_attachments_message_id_conversation_id_fkey(id, filename, kind, text_truncated)",
    )
    .eq("conversation_id", conversationId)
    .is("superseded_at", null)
    .order("seq");
  const rows = ids ? (allRows ?? []).filter((r) => ids.includes(r.id)) : (allRows ?? []);

  // RLS shows a source only to participants who can still read its memory.
  const { data: sourceRows } = await supabase
    .from("message_sources")
    .select(
      "message_id, position, source_type, title, excerpt, page, source_date, space_id, document_id, entry_id, chunk_id, char_start, char_end, space:memory_spaces(kind, client:clients(name))",
    )
    .eq("conversation_id", conversationId)
    .order("position");
  const sourcesByMessage = new Map<string, SourceProof[]>();
  for (const r of sourceRows ?? []) {
    const list = sourcesByMessage.get(r.message_id) ?? [];
    list.push({
      position: r.position,
      sourceType: r.source_type as SourceProof["sourceType"],
      title: r.title,
      excerpt: r.excerpt,
      page: r.page,
      sourceDate: r.source_date,
      spaceId: r.space_id,
      spaceKind: r.space?.kind ?? null,
      clientName: r.space?.client?.name ?? null,
      documentId: r.document_id,
      entryId: r.entry_id,
      chunkId: r.chunk_id,
      charStart: r.char_start,
      charEnd: r.char_end,
    });
    sourcesByMessage.set(r.message_id, list);
  }

  const now = Date.now();
  const messages: TimelineMessage[] = rows.map((m) => ({
    id: m.id,
    seq: m.seq,
    role: m.author_type === "assistant" ? "assistant" : "user",
    content: m.content,
    // An answer still "streaming" long after it started was interrupted (server restart): show it as stopped.
    status:
      m.status === "streaming" && now - new Date(m.created_at).getTime() > STALE_STREAM_MS
        ? "stopped"
        : (m.status as TimelineMessage["status"]),
    errorCode: m.error_code,
    createdAt: m.created_at,
    author: m.author ? { id: m.author.id, name: m.author.full_name } : null,
    model: m.provider && m.model_id ? { id: m.model_id, provider: m.provider, label: m.model_label ?? m.model_id } : null,
    routing: (m.routing as RoutingInfo | null) ?? null,
    omittedMessages: Number((m.context_meta as { omitted_messages?: number } | null)?.omitted_messages ?? 0),
    attachments: (m.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      kind: a.kind as AttachmentKind,
      truncated: a.text_truncated,
    })),
    sources: sourcesByMessage.get(m.id) ?? [],
    maskedContent: m.masked_content,
    hideCounts: (m.hide_counts as HideCounts | null) ?? null,
    hideSpans: Array.isArray(m.hide_spans) ? (m.hide_spans as Span[]) : [],
    contextLimited: Boolean((m.context_meta as { context_limited?: boolean } | null)?.context_limited),
    suggestedColleagues: ((m.context_meta as { suggested_colleagues?: SuggestedColleague[] } | null)?.suggested_colleagues ?? []).filter(
      (c) => typeof c?.userId === "string" && typeof c?.name === "string",
    ),
    confrontation: isConfrontation(m.confrontation) ? m.confrontation : null,
  }));

  return { rows, messages };
}

/** Some messages of a conversation, for real-time updates (a colleague's message, an answer they asked for). */
export async function getTimelineMessages(conversationId: string, ids: string[]): Promise<TimelineMessage[]> {
  return (await loadTimeline(await createClient(), conversationId, ids)).messages;
}
