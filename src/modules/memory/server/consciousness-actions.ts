"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { isMemoryTrace, toLearningState, type LearningState } from "../types";
import { indexEntry } from "./indexer";
import { runLearningJob } from "./learning";

/**
 * Cendr Consciousness in the chat: what an answer used from memory and what it taught it. Everything
 * is read with the viewer's own session (RLS): someone who may not read a memory sees nothing of it.
 */

const JOB_COLUMNS = "id, message_id, status, learned, confirmed, superseded, proposed, kept_private, forgotten_at";

/** The current state of an answer's learning (polled while it runs). */
export async function learningStatusAction(input: { jobId: string }): Promise<LearningState | null> {
  const ctx = await memberOrNull();
  const parsed = z.object({ jobId: z.uuid() }).safeParse(input);
  if (!ctx || !parsed.success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("memory_jobs").select(JOB_COLUMNS).eq("id", parsed.data.jobId).maybeSingle();
  return data ? toLearningState(data) : null;
}

/** "Try again" on a learning that failed (provider outage…): only the person whose turn it was. */
export async function retryLearningAction(input: { jobId: string }): Promise<LearningState | null> {
  const ctx = await memberOrNull();
  const parsed = z.object({ jobId: z.uuid() }).safeParse(input);
  if (!ctx || !parsed.success) return null;
  const supabase = await createClient();
  await runLearningJob(supabase, ctx, parsed.data.jobId);
  const { data } = await supabase.from("memory_jobs").select(JOB_COLUMNS).eq("id", parsed.data.jobId).maybeSingle();
  if (data?.learned) revalidatePath("/memory");
  return data ? toLearningState(data) : null;
}

export type LearnedFact = { id: string; title: string; content: string; kind: string; status: string; replaced: string | null; canWrite: boolean };
export type ProposedFact = { id: string; title: string; content: string; reason: string | null };

/** What a learning wrote (current versions) and what it proposes to confirm, as the viewer may see them. */
export async function learnedFactsAction(input: { jobId: string }): Promise<{ facts: LearnedFact[]; proposed: ProposedFact[]; clientName: string | null; spaceId: string } | null> {
  const ctx = await memberOrNull();
  const parsed = z.object({ jobId: z.uuid() }).safeParse(input);
  if (!ctx || !parsed.success) return null;
  const supabase = await createClient();
  const { data: job } = await supabase.from("memory_jobs").select("id, space_id, entry_ids").eq("id", parsed.data.jobId).maybeSingle();
  if (!job) return null;
  const [{ data: entries }, { data: replaced }, { data: suggestions }, { data: space }, { data: rights }] = await Promise.all([
    job.entry_ids.length
      ? supabase.from("memory_entries").select("id, title, content, kind, status").in("id", job.entry_ids)
      : Promise.resolve({ data: [] as { id: string; title: string; content: string; kind: string; status: string }[] }),
    job.entry_ids.length
      ? supabase.from("memory_entries").select("content, superseded_by").in("superseded_by", job.entry_ids)
      : Promise.resolve({ data: [] as { content: string; superseded_by: string | null }[] }),
    supabase.from("memory_suggestions").select("id, title, content, reason, status").eq("source_ref->>job_id", job.id).eq("status", "pending"),
    supabase.from("memory_spaces").select("client:clients(name)").eq("id", job.space_id).maybeSingle(),
    supabase.rpc("my_memory_spaces", { p_company: ctx.active.companyId }),
  ]);
  const canWrite = Boolean((rights ?? []).find((r) => r.space_id === job.space_id)?.can_write);
  const previous = new Map((replaced ?? []).map((r) => [r.superseded_by!, r.content]));
  return {
    facts: (entries ?? []).map((e) => ({ ...e, replaced: previous.get(e.id) ?? null, canWrite })),
    proposed: (suggestions ?? []).map((s) => ({ id: s.id, title: s.title, content: s.content, reason: s.reason })),
    clientName: space?.client?.name ?? null,
    spaceId: job.space_id,
  };
}

/** "Forget": what this answer taught is removed (the previous versions come back). */
export async function forgetLearningAction(input: { jobId: string }): Promise<ActionResult<{ removed: number }>> {
  const ctx = await memberOrNull();
  const parsed = z.object({ jobId: z.uuid() }).safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("forget_memory_job", { p_job: parsed.data.jobId });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/memory");
  return { ok: true, data: { removed: data ?? 0 } };
}

/** "Correct": the right version replaces the wrong one, which stays as history. */
export async function correctFactAction(input: { entryId: string; title: string; content: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await memberOrNull();
  const parsed = z
    .object({ entryId: z.uuid(), title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(20_000) })
    .safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("correct_memory_entry", {
    p_entry: parsed.data.entryId,
    p_title: parsed.data.title,
    p_content: parsed.data.content,
  });
  if (error || !id) return { ok: false, error: toErrorCode(error) };
  await indexEntry(supabase, ctx, { id, title: parsed.data.title, content: parsed.data.content });
  revalidatePath("/memory");
  return { ok: true, data: { id } };
}

/** "Don't learn from this message" (its author only), before or after the answer. */
export async function setMessageLearningAction(input: { messageId: string; learn: boolean }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  const parsed = z.object({ messageId: z.uuid(), learn: z.boolean() }).safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_message_learning", { p_message: parsed.data.messageId, p_learn: parsed.data.learn });
  return error ? { ok: false, error: toErrorCode(error) } : { ok: true };
}

export type UsedMemory = {
  id: string;
  type: "entry" | "document";
  title: string;
  excerpt: string;
  where: { kind: "company" | "client"; clientName: string | null };
  date: string | null;
  reason: "brief" | "search";
  kind: string | null;
  /** Opens the memory (entries) or the document. */
  href: string;
};

/**
 * "Why this context?": the memories an answer received, resolved with the viewer's rights now. A
 * memory the viewer cannot read (any more) is not shown, and is not counted.
 */
export async function usedMemoryAction(input: { messageId: string }): Promise<{ items: UsedMemory[]; recent: number; waitedMs: number; pending: number; blocked: { kind: string; clientName: string | null }[] } | null> {
  const ctx = await memberOrNull();
  const parsed = z.object({ messageId: z.uuid() }).safeParse(input);
  if (!ctx || !parsed.success) return null;
  const supabase = await createClient();
  const { data: message } = await supabase.from("messages").select("context_meta").eq("id", parsed.data.messageId).maybeSingle();
  const trace = (message?.context_meta as { memory?: unknown } | null)?.memory;
  if (!isMemoryTrace(trace)) return null;
  const entryIds = trace.used.filter((u) => u.t === "e").map((u) => u.id);
  const chunkIds = trace.used.filter((u) => u.t === "d").map((u) => u.id);
  const [{ data: entries }, { data: chunks }, { data: spaces }] = await Promise.all([
    entryIds.length
      ? supabase.from("memory_entries").select("id, space_id, title, content, kind, effective_at, updated_at").in("id", entryIds)
      : Promise.resolve({ data: [] as { id: string; space_id: string; title: string; content: string; kind: string; effective_at: string | null; updated_at: string }[] }),
    chunkIds.length
      ? supabase.from("document_chunks").select("id, space_id, content, document:documents(id, filename, created_at)").in("id", chunkIds)
      : Promise.resolve({ data: [] as { id: string; space_id: string; content: string; document: { id: string; filename: string; created_at: string } | null }[] }),
    supabase.from("memory_spaces").select("id, kind, client:clients(name)").in("id", [...new Set(trace.used.map((u) => u.s))]),
  ]);
  const spaceById = new Map((spaces ?? []).map((s) => [s.id, { kind: s.kind, clientName: s.client?.name ?? null }]));
  const items: UsedMemory[] = [];
  for (const u of trace.used) {
    const where = spaceById.get(u.s);
    if (!where) continue;
    if (u.t === "e") {
      const e = (entries ?? []).find((x) => x.id === u.id);
      if (!e) continue;
      items.push({ id: e.id, type: "entry", title: e.title, excerpt: e.content.slice(0, 280), where, date: e.effective_at ?? e.updated_at, reason: u.r, kind: e.kind, href: `/memory/${e.space_id}` });
    } else {
      const c = (chunks ?? []).find((x) => x.id === u.id);
      if (!c?.document) continue;
      items.push({ id: c.id, type: "document", title: c.document.filename, excerpt: c.content.slice(0, 280), where, date: c.document.created_at, reason: u.r, kind: null, href: `/memory/documents/${c.document.id}` });
    }
  }
  return { items, recent: trace.recent, waitedMs: trace.waitedMs, pending: trace.pending, blocked: trace.blocked.map((b) => ({ kind: b.kind, clientName: b.clientName })) };
}
