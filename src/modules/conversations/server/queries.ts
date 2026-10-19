import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RoutingInfo } from "../stream-events";
import type { TimelineMessage } from "../types";

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
    .select("id, company_id, client_id, owner_id, title, model_choice, created_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;

  const { data: rows } = await supabase
    .from("messages")
    .select(
      "id, seq, author_type, content, status, error_code, created_at, provider, model_id, model_label, routing, context_meta, author:profiles!messages_author_id_fkey(id, full_name), attachments:conversation_attachments!conversation_attachments_message_id_conversation_id_fkey(id, filename, kind, text_truncated)",
    )
    .eq("conversation_id", conversationId)
    .is("superseded_at", null)
    .order("seq");

  const now = Date.now();
  const messages: TimelineMessage[] = (rows ?? []).map((m) => ({
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
      kind: a.kind as "image" | "document",
      truncated: a.text_truncated,
    })),
  }));

  return { ...conversation, messages };
}

export type ConversationDetail = NonNullable<Awaited<ReturnType<typeof getConversation>>>;
