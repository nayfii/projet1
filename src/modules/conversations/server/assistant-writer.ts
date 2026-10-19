import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { CatalogModel } from "@/modules/providers/catalog";

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
