import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import type { Json } from "@/lib/supabase/database.types";
import type { UserClient } from "@/lib/supabase/server";
import { PLACEHOLDER_PATTERN } from "@/modules/hide/categories";
import { restorePlaceholders } from "@/modules/hide/mask";
import { hideConfigured } from "@/modules/hide/server/crypto";
import { conversationValues } from "@/modules/hide/server/masker";
import { decideFact, learnFactsSystem, parseCandidateFacts, planWrite, type CandidateFact, type FactAttributes, type KnownFact } from "../learning";
import { runMemoryTask } from "./ai-tasks";
import { indexEntry } from "./indexer";

/**
 * The write path of Cendr Consciousness (docs/CONSCIOUSNESS.md §3), run on our server after an
 * answer, with the asker's own session: RLS proves at every write that they may write this client's
 * memory. One job per answer (idempotent); a job that fails is retried later (3 attempts).
 *
 * exchange → candidate facts (model) → rules (learning.ts) → dedup / supersede → store → index.
 */

export type LearningOutcome = {
  jobId: string;
  status: "done" | "skipped" | "failed";
  learned: number;
  confirmed: number;
  superseded: number;
  proposed: number;
  keptPrivate: number;
};

const MAX_KNOWN = 40;

/** Queues the learning for a finished answer. Null when nothing may be learned from it. */
export async function enqueueLearning(supabase: UserClient, messageId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("enqueue_memory_job", { p_message: messageId });
  return error ? null : (data ?? null);
}

/** Runs one job end to end. Safe to call twice: only one run claims it. */
export async function runLearningJob(supabase: UserClient, ctx: MemberContext, jobId: string): Promise<LearningOutcome | null> {
  const { data: claimed } = await supabase.rpc("claim_memory_job", { p_job: jobId });
  if (!claimed) return null;
  const finish = async (o: Omit<LearningOutcome, "jobId">, entryIds: string[] = [], error: string | null = null): Promise<LearningOutcome> => {
    await supabase.rpc("finish_memory_job", {
      p_job: jobId,
      p_status: o.status,
      p_learned: o.learned,
      p_confirmed: o.confirmed,
      p_superseded: o.superseded,
      p_proposed: o.proposed,
      p_private: o.keptPrivate,
      p_entries: entryIds,
      p_error: error ?? undefined,
    });
    return { jobId, ...o };
  };
  const empty = { learned: 0, confirmed: 0, superseded: 0, proposed: 0, keptPrivate: 0 };
  try {
    const { data: job } = await supabase.from("memory_jobs").select("id, conversation_id, message_id, space_id").eq("id", jobId).single();
    if (!job) return await finish({ status: "failed", ...empty }, [], "not_found");
    const [{ data: conversation }, { data: answer }] = await Promise.all([
      supabase.from("conversations").select("id, client:clients(name)").eq("id", job.conversation_id).maybeSingle(),
      supabase.from("messages").select("seq, content, masked_content, model_id, status").eq("id", job.message_id).maybeSingle(),
    ]);
    if (!conversation || !answer || answer.status !== "complete") return await finish({ status: "skipped", ...empty }, [], "answer_gone");
    const { data: question } = await supabase
      .from("messages")
      .select("content, masked_content, no_memory")
      .eq("conversation_id", job.conversation_id)
      .eq("author_type", "user")
      .lt("seq", answer.seq)
      .is("superseded_at", null)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!question?.content.trim() || question.no_memory) return await finish({ status: "skipped", ...empty });

    // Facts already known (active, with a key): the model reuses their keys, and duplicates are caught.
    const [{ data: knownRows }, { data: space }, { data: alreadyRows }] = await Promise.all([
      supabase
        .from("memory_entries")
        .select("id, subject_key, title, content, attributes")
        .eq("space_id", job.space_id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(MAX_KNOWN),
      supabase.from("memory_spaces").select("blocked_providers").eq("id", job.space_id).maybeSingle(),
      // A retried job never writes the same fact twice.
      supabase.from("memory_entries").select("subject_key").eq("space_id", job.space_id).eq("source_ref->>job_id", jobId),
    ]);
    const known: KnownFact[] = (knownRows ?? []).map((r) => ({ id: r.id, key: r.subject_key, title: r.title, content: r.content, attributes: (r.attributes ?? {}) as FactAttributes }));
    const already = new Set((alreadyRows ?? []).map((r) => r.subject_key));

    // The model that wrote the answer reads the exchange (it already received it, as masked by Hide).
    const userText = question.masked_content ?? question.content;
    const exchange = [`User: ${userText}`, `Assistant: ${answer.masked_content ?? answer.content}`].join("\n\n").slice(-12_000);
    // Hide replaced something in this exchange (a masked copy identical to the text masks nothing).
    const masked = (answer.masked_content ?? answer.content) !== answer.content || (question.masked_content ?? question.content) !== question.content;
    const values = masked && hideConfigured() ? await conversationValues(job.conversation_id, [exchange]) : new Map<string, string>();
    const clientName = conversation.client?.name ?? "";
    const placeholder = [...values].find(([, value]) => value.trim().toLowerCase() === clientName.trim().toLowerCase())?.[0];
    const clientRef = masked ? (placeholder ?? "linked to this conversation") : clientName;
    // Known facts go to that model only if this memory may be sent to its provider; with Hide, they
    // are left out (they hold real values the exchange has as placeholders).
    const { data: model } = answer.model_id ? await supabase.from("ai_models").select("provider").eq("id", answer.model_id).maybeSingle() : { data: null };
    const blocked = new Set<string>((space?.blocked_providers ?? []) as string[]);
    const shareKnown = !masked && model !== null && !blocked.has(model.provider);
    const result = await runMemoryTask(supabase, ctx, {
      system: learnFactsSystem(clientRef, shareKnown ? known.filter((k) => k.key).map((k) => ({ key: k.key!, content: k.content })) : []),
      user: exchange,
      modelChoice: answer.model_id ?? undefined,
    });
    if (!result.ok) return await finish({ status: "failed", ...empty }, [], result.error);

    const counts = { ...empty };
    const entryIds: string[] = [];
    const proposals: { fact: CandidateFact; reason: "assistant_claim" | "uncertain" }[] = [];
    // Real values back in every field (and in the subject key) before the rules: a placeholder left
    // means a value this person was not shown, never stored.
    for (const fact of parseCandidateFacts(result.text, (text) => restorePlaceholders(text, values))) {
      if (new RegExp(PLACEHOLDER_PATTERN.source).test(`${fact.title}\n${fact.content}\n${fact.key}`)) continue;
      const decision = decideFact(fact, question.content, known);
      if (decision === "drop") continue;
      if (decision === "private") {
        counts.keptPrivate++;
        continue;
      }
      const restored = fact;
      if (decision === "confirm") {
        // An answer restating what the memory already holds (a colleague asked for it): nothing to confirm.
        if (planWrite(restored, known).action === "confirm") continue;
        proposals.push({ fact: restored, reason: fact.statedBy === "user" ? "uncertain" : "assistant_claim" });
        continue;
      }
      if (already.has(fact.key)) continue;
      const plan = planWrite(restored, known);
      if (plan.action === "confirm") {
        await supabase.from("memory_entries").update({ confirmed_at: new Date().toISOString() }).eq("id", plan.existingId);
        counts.confirmed++;
        continue;
      }
      const { data: created, error } = await supabase
        .from("memory_entries")
        .insert({
          space_id: job.space_id,
          title: restored.title,
          content: restored.content,
          source_type: "auto",
          source_ref: { conversation_id: job.conversation_id, message_id: job.message_id, job_id: jobId } as { [key: string]: Json },
          kind: restored.kind,
          subject_key: restored.key,
          confidence: restored.confidence,
          attributes: restored.attributes as { [key: string]: Json },
          effective_at: restored.effectiveDate ? `${restored.effectiveDate}T00:00:00Z` : null,
        })
        .select("id, title, content")
        .single();
      if (error || !created) continue;
      entryIds.push(created.id);
      counts.learned++;
      known.unshift({ id: created.id, key: restored.key, title: restored.title, content: restored.content, attributes: restored.attributes });
      if (plan.action === "supersede") {
        if (await supersede(supabase, job.space_id, restored.key, plan.existingId, created.id)) counts.superseded++;
      }
      await indexEntry(supabase, ctx, created);
    }
    if (proposals.length > 0) {
      const { data: rows } = await supabase
        .from("memory_suggestions")
        .insert(
          proposals.slice(0, 4).map(({ fact, reason }) => ({
            space_id: job.space_id,
            kind: "new_entry",
            title: fact.title,
            content: fact.content,
            source_ref: { conversation_id: job.conversation_id, message_id: job.message_id, job_id: jobId } as { [key: string]: Json },
            fact_kind: fact.kind,
            subject_key: fact.key,
            attributes: fact.attributes as { [key: string]: Json },
            reason,
          })),
        )
        .select("id");
      counts.proposed = rows?.length ?? 0;
    }
    return await finish({ status: "done", ...counts }, entryIds);
  } catch {
    return await finish({ status: "failed", ...empty }, [], "server_error");
  }
}

/**
 * Replaces the older fact. If another learning replaced it a moment ago, the fact now current for
 * this subject is replaced instead (never two current values for one subject).
 */
async function supersede(supabase: UserClient, spaceId: string, key: string, oldId: string, newId: string): Promise<boolean> {
  const { error } = await supabase.rpc("supersede_memory_entry", { p_old: oldId, p_new: newId });
  if (!error) return true;
  const { data: current } = await supabase
    .from("memory_entries")
    .select("id")
    .eq("space_id", spaceId)
    .eq("subject_key", key)
    .eq("status", "active")
    .neq("id", newId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!current) return false;
  return !(await supabase.rpc("supersede_memory_entry", { p_old: current.id, p_new: newId })).error;
}

/**
 * After a turn: runs the job just queued, then retries this person's own jobs that stopped or failed
 * (a server restart, a provider outage), a few at a time.
 */
export async function runPendingLearning(supabase: UserClient, ctx: MemberContext, jobId: string | null): Promise<LearningOutcome | null> {
  const outcome = jobId ? await runLearningJob(supabase, ctx, jobId) : null;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const stale = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: retry } = await supabase
    .from("memory_jobs")
    .select("id, status, locked_at, created_at, attempts")
    .eq("user_id", ctx.user.id)
    .gte("created_at", since)
    .in("status", ["queued", "running", "failed"])
    .lt("attempts", 3)
    .order("created_at", { ascending: false })
    .limit(5);
  for (const job of (retry ?? []).filter((j) => j.id !== jobId).slice(0, 2)) {
    const stuck = job.status === "running" ? (job.locked_at ?? job.created_at) < stale : job.status === "failed" || job.created_at < stale;
    if (stuck) await runLearningJob(supabase, ctx, job.id);
  }
  return outcome;
}
