"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { restorePlaceholders } from "@/modules/hide/mask";
import { hideConfigured } from "@/modules/hide/server/crypto";
import { conversationValues } from "@/modules/hide/server/masker";
import { runMemoryTask } from "@/modules/memory/server/ai-tasks";
import { getCompanyModels } from "@/modules/providers/server/models";
import { TITLE_SYSTEM, cleanTitle, shouldRetitle, titleRequest } from "../titles";

/**
 * Automatic titles (like ChatGPT or Claude): after the first answer, then every few questions in case
 * the topic changed. The AI reads the questions as the chat models received them (Hide placeholders),
 * the title gets the real values back for the people of the conversation. A title renamed by hand stays.
 */
export async function refreshTitleAction(input: { conversationId: string }): Promise<{ title: string } | null> {
  const ctx = await memberOrNull();
  if (!ctx) return null;
  const parsed = z.object({ conversationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data: conversation } = await supabase.from("conversations").select("id, title, title_auto").eq("id", parsed.data.conversationId).maybeSingle();
  if (!conversation?.title_auto) return null;

  const { data: rows } = await supabase
    .from("messages")
    .select("author_type, content, masked_content, status")
    .eq("conversation_id", conversation.id)
    .is("superseded_at", null)
    .order("seq");
  const questions = (rows ?? []).filter((m) => m.author_type === "user" && m.content.trim()).map((m) => m.masked_content ?? m.content);
  const answered = (rows ?? []).some((m) => m.author_type === "assistant" && m.status === "complete");
  if (!answered || !shouldRetitle(questions.length)) return null;

  // A small, fast model is enough for a title.
  const models = await getCompanyModels(ctx.active.companyId);
  const fast = models.allowed.find((m) => m.tier === "fast" && models.configured.has(m.provider));
  const request = titleRequest(conversation.title, questions);
  const result = await runMemoryTask(supabase, ctx, { system: TITLE_SYSTEM, user: request, modelChoice: fast?.id, feature: "title" });
  if (!result.ok) return null;
  const masked = (rows ?? []).some((m) => m.masked_content !== null);
  const values = masked && hideConfigured() ? await conversationValues(conversation.id, [request]) : new Map<string, string>();
  const title = cleanTitle(restorePlaceholders(result.text, values));
  if (!title || title === conversation.title) return title ? { title } : null;
  const { data: saved } = await supabase.rpc("set_auto_title", { p_conversation: conversation.id, p_title: title });
  return saved ? { title } : null;
}
