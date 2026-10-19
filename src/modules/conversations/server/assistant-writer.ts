import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { CatalogModel } from "@/modules/providers/catalog";
import type { SourceProof } from "@/modules/memory/types";

/**
 * AUDITED service-role module (docs/ARCHITECTURE.md §5). Only the server writes AI answers:
 * users cannot insert or edit assistant messages (RLS + column grants), so an answer shown as
 * "Claude" really comes from Claude. Callers must have authorised the user on the conversation
 * (with the user's own session) before calling these functions.
 */

export async function createAssistantMessage(input: {
  conversationId: string;
  model: CatalogModel;
  routing: Json | null;
  contextMeta: Json | null;
}): Promise<{ id: string; seq: number }> {
  const { data, error } = await createAdminClient()
    .from("messages")
    .insert({
      // company_id and seq are set by the database trigger from the conversation.
      conversation_id: input.conversationId,
      author_type: "assistant",
      author_id: null,
      content: "",
      provider: input.model.provider,
      model_id: input.model.id,
      api_model_id: input.model.apiModelId,
      model_label: input.model.label,
      routing: input.routing,
      context_meta: input.contextMeta,
      status: "streaming",
    })
    .select("id, seq")
    .single();
  if (error || !data) throw new Error(`assistant message insert failed: ${error?.code ?? "no data"}`);
  return data;
}

export async function finishAssistantMessage(
  id: string,
  result: {
    content: string;
    /** Hide: the answer as the model wrote it, with placeholders (null when nothing was restored). */
    maskedContent?: string | null;
    /** Replaces the context metadata set at creation (e.g. adds Who Can Help suggestions). */
    contextMeta?: Json | null;
    status: "complete" | "error" | "stopped";
    errorCode: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
  },
): Promise<void> {
  const { error } = await createAdminClient()
    .from("messages")
    .update({
      content: result.content,
      masked_content: result.maskedContent ?? null,
      ...(result.contextMeta !== undefined ? { context_meta: result.contextMeta } : {}),
      status: result.status,
      error_code: result.errorCode,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    })
    .eq("id", id)
    .eq("author_type", "assistant");
  if (error) console.error("assistant message update failed", { code: error.code });
}

/** "Regenerate": hides the previous answer from the timeline and from future AI context. */
export async function supersedeMessage(id: string, conversationId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("messages")
    .update({ superseded_at: new Date().toISOString() })
    .eq("id", id)
    .eq("conversation_id", conversationId)
    .eq("author_type", "assistant");
  if (error) console.error("supersede failed", { code: error.code });
}

/** Stop button: flags the answer; the server writing it checks the flag and stops within a second. */
export async function requestStop(id: string, conversationId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("messages")
    .update({ stop_requested_at: new Date().toISOString() })
    .eq("id", id)
    .eq("conversation_id", conversationId)
    .eq("author_type", "assistant")
    .eq("status", "streaming")
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

export async function isStopRequested(id: string): Promise<boolean> {
  const { data } = await createAdminClient().from("messages").select("stop_requested_at").eq("id", id).maybeSingle();
  return Boolean(data?.stop_requested_at);
}

/** Source Proof rows for an answer (users cannot write them: an answer's sources are always genuine). */
export async function saveMessageSources(messageId: string, conversationId: string, sources: SourceProof[]): Promise<void> {
  const { error } = await createAdminClient()
    .from("message_sources")
    .insert(
      sources.map((s) => ({
        message_id: messageId,
        conversation_id: conversationId,
        position: s.position,
        source_type: s.sourceType,
        space_id: s.spaceId,
        document_id: s.documentId,
        chunk_id: s.chunkId ?? null,
        entry_id: s.entryId,
        title: s.title,
        excerpt: s.excerpt,
        page: s.page,
        char_start: s.charStart,
        char_end: s.charEnd,
        source_date: s.sourceDate,
      })),
    );
  if (error) console.error("message_sources insert failed", { code: error.code });
}
