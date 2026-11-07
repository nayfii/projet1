import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";
import type { KnowledgePassage, MemoryTrace } from "../types";

export type { MemoryTrace };
import { embedQuery } from "./indexer";
import { clientNamesOf, conversationScope, MAX_PASSAGES, myMemorySpaces, searchSpaces, type MemorySpace } from "./retrieval";

/**
 * Cendr Context Gateway (docs/CONSCIOUSNESS.md §4): what a model receives from memory, whichever
 * model it is. Built for each request, with the requester's own session, in this order:
 *
 * 1. the authorised search space first: memories the person (in a group: every participant) may
 *    read, minus those the company keeps away from this provider;
 * 2. a learning still running in this client's memory (a fact told to another model seconds ago)
 *    is waited for, briefly;
 * 3. the client's key facts (decisions, commitments, budgets, dates, contacts), always given;
 * 4. passages found for the question (meaning + exact words), current facts only;
 * 5. the person's own recent messages about this client that learning has not processed yet;
 * 6. conflicts flagged: two current facts on one subject are given as such, never as settled.
 *
 * Nothing is cached between requests: every retrieval re-checks rights, so a removed member, an
 * expired access or a deleted fact is gone from the next answer. The trace lists exactly what was
 * given (ids only), and is shown under the answer.
 */

export const BRIEF_MAX_FACTS = 8;
const BRIEF_FACT_CHARS = 400;
const WAIT_FOR_LEARNING_MS = 2500;
const RECENT_WINDOW_MS = 30 * 60_000;



export type MemoryContext = { passages: KnowledgePassage[]; recent: string[]; trace: MemoryTrace };

const KIND_PRIORITY: Record<string, number> = { decision: 0, commitment: 0, fact: 1, contact: 1, preference: 2, procedure: 2, note: 3 };

/** Greetings and thanks need no search (the brief is still given to a client conversation). */
export function needsSearch(query: string): boolean {
  const words = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  const small = new Set(["merci", "thanks", "thank", "you", "ok", "okay", "super", "parfait", "bonjour", "hello", "hi", "salut", "top", "cool", "beaucoup", "great", "yes", "oui", "non", "no", "d", "accord"]);
  return words.length > 4 || words.some((w) => !small.has(w));
}

export async function buildMemoryContext(
  supabase: UserClient,
  ctx: MemberContext,
  options: {
    conversationId: string;
    clientId: string | null;
    query: string;
    /** Text sent to the embeddings provider (the masked question when Hide is on). */
    embeddingQuery?: string;
    /** Group conversation (intersection of permissions), or a tool limited to company memory. */
    restrictTo?: ReadonlySet<string>;
    /** Providers that will receive the context (Confronter: several). */
    providers: string[];
    /** The person's own recent messages may be given (never in a group). */
    ownRecent: boolean;
  },
): Promise<MemoryContext> {
  const started = Date.now();
  const all = conversationScope(await myMemorySpaces(supabase, ctx.active.companyId), options.clientId).filter(
    (s) => !options.restrictTo || options.restrictTo.has(s.spaceId),
  );
  const blockedSpaces = all.filter((s) => s.blockedProviders.some((p) => options.providers.includes(p)));
  const scope = all.filter((s) => !blockedSpaces.includes(s));
  const names = await clientNamesOf(supabase, all);
  const trace: MemoryTrace = {
    used: [],
    recent: 0,
    waitedMs: 0,
    pending: 0,
    blocked: blockedSpaces.map((s) => ({ spaceId: s.spaceId, kind: s.kind, clientName: s.clientId ? (names.get(s.clientId) ?? null) : null })),
    ms: 0,
  };
  const clientSpace = options.clientId ? scope.find((s) => s.clientId === options.clientId) : undefined;
  const search = needsSearch(options.query);

  // The question's vector is computed while we wait for a learning in progress.
  const [embedding, pending] = await Promise.all([
    search && scope.some((s) => s.entryCount > 0 || s.documentCount > 0)
      ? embedQuery(supabase, ctx, options.embeddingQuery?.trim() || options.query)
      : Promise.resolve(null),
    clientSpace ? waitForLearning(supabase, clientSpace.spaceId, options.conversationId) : Promise.resolve({ waitedMs: 0, pending: 0 }),
  ]);
  trace.waitedMs = pending.waitedMs;
  trace.pending = pending.pending;

  const brief = clientSpace ? await clientBrief(supabase, clientSpace, names) : [];
  const found = search
    ? await searchSpaces(supabase, ctx, scope, {
        query: options.query,
        embedding,
        excludeIds: new Set(brief.map((b) => b.id)),
        limit: MAX_PASSAGES,
      })
    : [];
  const passages = [...brief, ...found].map((p, i) => ({ ...p, position: i + 1 }));
  await flagConflicts(supabase, passages);

  const recent = clientSpace && options.ownRecent ? await ownRecentMessages(supabase, ctx, clientSpace.spaceId, options.conversationId) : [];
  trace.recent = recent.length;
  trace.used = passages.map((p) => ({ t: p.sourceType === "document_chunk" ? "d" : "e", id: p.id, s: p.spaceId, r: p.reason ?? "search" }));
  trace.ms = Date.now() - started;
  return { passages, recent, trace };
}

/** Waits (briefly) for learnings still running in this memory, from other conversations. */
async function waitForLearning(supabase: UserClient, spaceId: string, conversationId: string): Promise<{ waitedMs: number; pending: number }> {
  const started = Date.now();
  let pending = 0;
  for (;;) {
    const { data } = await supabase.rpc("pending_memory_jobs", { p_spaces: [spaceId], p_except_conversation: conversationId });
    pending = data ?? 0;
    if (pending === 0 || Date.now() - started >= WAIT_FOR_LEARNING_MS) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { waitedMs: pending === 0 && Date.now() - started < 50 ? 0 : Date.now() - started, pending };
}

/** The client's key facts: current, not expired, most important and most recent first. */
async function clientBrief(supabase: UserClient, space: MemorySpace, names: Map<string, string>): Promise<KnowledgePassage[]> {
  const { data } = await supabase
    .from("memory_entries")
    .select("id, title, content, kind, effective_at, expires_at, updated_at")
    .eq("space_id", space.spaceId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(40);
  const now = Date.now();
  const kept = (data ?? [])
    .filter((e) => !e.expires_at || new Date(e.expires_at).getTime() > now)
    .sort((a, b) => (KIND_PRIORITY[a.kind] ?? 3) - (KIND_PRIORITY[b.kind] ?? 3) || b.updated_at.localeCompare(a.updated_at))
    .slice(0, BRIEF_MAX_FACTS);
  const replaced = await recentlyReplaced(supabase, kept.map((e) => e.id));
  return kept.map((e, i) => ({
      position: i + 1,
      sourceType: "memory_entry" as const,
      id: e.id,
      documentId: null,
      spaceId: space.spaceId,
      spaceKind: space.kind,
      clientName: space.clientId ? (names.get(space.clientId) ?? null) : null,
      title: e.title,
      content: e.content.length > BRIEF_FACT_CHARS ? `${e.content.slice(0, BRIEF_FACT_CHARS)}…` : e.content,
      page: null,
      charStart: null,
      charEnd: null,
      sourceDate: e.effective_at ?? e.updated_at,
      reason: "brief" as const,
      kind: e.kind,
      ...(replaced.has(e.id) ? { replaced: replaced.get(e.id) } : {}),
    }));
}

/**
 * Facts that replaced an older value in the last 90 days: the model is told what changed and when,
 * so it says "the budget went from 15 000 € to 18 000 €" rather than taking an earlier answer for a
 * mistake (found with a real model).
 */
async function recentlyReplaced(supabase: UserClient, ids: string[]): Promise<Map<string, { content: string; on: string }>> {
  const notes = new Map<string, { content: string; on: string }>();
  if (ids.length === 0) return notes;
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("memory_entries")
    .select("content, superseded_by, superseded_at")
    .in("superseded_by", ids)
    .gte("superseded_at", since)
    .order("superseded_at", { ascending: false });
  for (const old of data ?? []) {
    if (!old.superseded_by || !old.superseded_at || notes.has(old.superseded_by)) continue;
    const content = old.content.length > BRIEF_FACT_CHARS ? `${old.content.slice(0, BRIEF_FACT_CHARS)}…` : old.content;
    notes.set(old.superseded_by, { content, on: old.superseded_at.slice(0, 10) });
  }
  return notes;
}

/** Two current facts about the same subject in one memory: both are flagged. */
async function flagConflicts(supabase: UserClient, passages: KnowledgePassage[]): Promise<void> {
  const entryIds = passages.filter((p) => p.sourceType === "memory_entry").map((p) => p.id);
  if (entryIds.length === 0) return;
  const { data: keyed } = await supabase.from("memory_entries").select("id, space_id, subject_key, kind").in("id", entryIds).not("subject_key", "is", null);
  if (!keyed?.length) return;
  for (const k of keyed) {
    const p = passages.find((x) => x.id === k.id);
    if (p && !p.kind) p.kind = k.kind;
  }
  const { data: same } = await supabase
    .from("memory_entries")
    .select("id, space_id, subject_key")
    .in("space_id", [...new Set(keyed.map((k) => k.space_id))])
    .in("subject_key", [...new Set(keyed.map((k) => k.subject_key!))])
    .eq("status", "active");
  const count = new Map<string, number>();
  for (const s of same ?? []) count.set(`${s.space_id}|${s.subject_key}`, (count.get(`${s.space_id}|${s.subject_key}`) ?? 0) + 1);
  for (const k of keyed) {
    if ((count.get(`${k.space_id}|${k.subject_key}`) ?? 0) > 1) {
      const p = passages.find((x) => x.id === k.id);
      if (p) p.conflict = true;
    }
  }
}

/**
 * Hot memory: what this person told an AI about this client in another conversation a moment ago,
 * while its learning is not done yet. Their own words only, to themselves only (others get the
 * facts once learned, never someone's raw messages). Messages Hide masked are left out: their
 * placeholders belong to the other conversation.
 */
async function ownRecentMessages(supabase: UserClient, ctx: MemberContext, spaceId: string, conversationId: string): Promise<string[]> {
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const { data: jobs } = await supabase
    .from("memory_jobs")
    .select("conversation_id, message_id")
    .eq("user_id", ctx.user.id)
    .eq("space_id", spaceId)
    .in("status", ["queued", "running", "failed"])
    .neq("conversation_id", conversationId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3);
  const out: string[] = [];
  for (const job of jobs ?? []) {
    const { data: answer } = await supabase.from("messages").select("seq").eq("id", job.message_id).maybeSingle();
    if (!answer) continue;
    const { data: question } = await supabase
      .from("messages")
      .select("content, masked_content, no_memory, author_id")
      .eq("conversation_id", job.conversation_id)
      .eq("author_type", "user")
      .lt("seq", answer.seq)
      .is("superseded_at", null)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!question || question.no_memory || question.author_id !== ctx.user.id) continue;
    if (question.masked_content !== null && question.masked_content !== question.content) continue;
    if (question.content.trim()) out.push(question.content.trim().slice(0, 1500));
  }
  return out;
}
