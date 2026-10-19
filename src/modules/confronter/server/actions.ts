"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toConfrontationModel } from "../prompts";
import type { ConfrontationModel } from "../types";
import { planConfrontation } from "./plan";

export type ConfrontEstimate =
  | { ok: false; reason: "not_enough_models" | "quota_user" | "quota_company" | "not_found"; models: ConfrontationModel[] }
  | { ok: true; models: ConfrontationModel[]; judge: ConfrontationModel; credits: number; single: number; remaining: number; enough: boolean };

/** What a confrontation of this question would involve and cost, shown before running (CLAUDE.md §4.5). */
export async function estimateConfrontationAction(input: { conversationId: string; messageId: string }): Promise<ConfrontEstimate> {
  const ctx = await memberOrNull();
  const parsed = z.object({ conversationId: z.uuid(), messageId: z.uuid() }).safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, reason: "not_found", models: [] };
  const supabase = await createClient();
  // RLS: only messages this person may see.
  const { data: rows } = await supabase
    .from("messages")
    .select("id, seq, author_type, content, attachments:conversation_attachments!conversation_attachments_message_id_conversation_id_fkey(extracted_text)")
    .eq("conversation_id", parsed.data.conversationId)
    .is("superseded_at", null)
    .order("seq");
  const question = (rows ?? []).find((r) => r.id === parsed.data.messageId && r.author_type === "user");
  if (!question) return { ok: false, reason: "not_found", models: [] };
  const historyChars = (rows ?? [])
    .filter((r) => r.seq <= question.seq)
    .reduce((n, r) => n + r.content.length + (r.attachments ?? []).reduce((m, a) => m + (a.extracted_text?.length ?? 0), 0), 0);
  const plan = await planConfrontation(ctx.active.companyId, historyChars);
  if (!plan.ok) return { ok: false, reason: plan.reason, models: plan.models.map(toConfrontationModel) };
  return {
    ok: true,
    models: plan.models.map(toConfrontationModel),
    judge: toConfrontationModel(plan.judge),
    credits: plan.credits,
    single: plan.single,
    remaining: Number.isFinite(plan.remaining) ? Math.floor(plan.remaining) : plan.remaining,
    enough: plan.enough,
  };
}
