import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";
import { keywordQuery } from "../keywords";
import type { KnowledgePassage } from "../types";
import { embeddingModelName } from "@/modules/providers/server/embeddings";
import { embedQuery } from "./indexer";

export const MAX_PASSAGES = 6;
const PASSAGE_MAX_CHARS = 1_600;

export type MemorySpace = {
  spaceId: string;
  kind: "company" | "client";
  clientId: string | null;
  canWrite: boolean;
  entryCount: number;
  documentCount: number;
  /** AI providers this memory must never be sent to (company rule). */
  blockedProviders: string[];
};

/** Memories the signed-in user can read (and write), checked in SQL with their session. */
export async function myMemorySpaces(supabase: UserClient, companyId: string): Promise<MemorySpace[]> {
  const { data } = await supabase.rpc("my_memory_spaces", { p_company: companyId });
  return (data ?? []).map((s) => ({
    spaceId: s.space_id,
    kind: s.kind,
    clientId: s.client_id,
    canWrite: s.can_write,
    entryCount: Number(s.entry_count),
    documentCount: Number(s.document_count),
    blockedProviders: (s.blocked_providers ?? []) as string[],
  }));
}

/**
 * Which memories a conversation may draw from. Linked to a client: company memory + that client's memory.
 * Not linked: company memory + every client memory the user can read. Group conversations (Step 5)
 * will intersect this with the other participants' spaces.
 */
export function conversationScope(spaces: MemorySpace[], clientId: string | null): MemorySpace[] {
  return spaces.filter((s) => s.kind === "company" || (clientId ? s.clientId === clientId : true));
}

/**
 * Finds the passages to give the model. Permission filtering happens here, before any model sees
 * anything: only readable spaces are searched (first barrier) and RLS re-checks every row (second).
 */
export async function retrievePassages(
  supabase: UserClient,
  ctx: MemberContext,
  /**
   * `embeddingQuery`: the text sent to the embeddings provider (the masked question when Hide is on).
   * `restrictTo`: in a group conversation, the memories every participant may read (intersection).
   */
  options: { clientId: string | null; query: string; embeddingQuery?: string; restrictTo?: ReadonlySet<string> },
): Promise<KnowledgePassage[]> {
  const scope = conversationScope(await myMemorySpaces(supabase, ctx.active.companyId), options.clientId).filter(
    (s) => !options.restrictTo || options.restrictTo.has(s.spaceId),
  );
  return searchSpaces(supabase, ctx, scope, { query: options.query, embedding: undefined, embeddingQuery: options.embeddingQuery });
}

/** Client names of the client memories in a scope (to label passages). */
export async function clientNamesOf(supabase: UserClient, scope: MemorySpace[]): Promise<Map<string, string>> {
  const clientIds = [...new Set(scope.filter((s) => s.clientId).map((s) => s.clientId!))];
  if (clientIds.length === 0) return new Map();
  const { data } = await supabase.from("clients").select("id, name").in("id", clientIds);
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}

/**
 * Hybrid search (meaning + exact words) inside the given spaces, current facts only. `embedding`:
 * a vector already computed for this question (undefined: computed here; null: words only).
 */
export async function searchSpaces(
  supabase: UserClient,
  ctx: MemberContext,
  scope: MemorySpace[],
  options: { query: string; embeddingQuery?: string; embedding?: string | null; excludeIds?: ReadonlySet<string>; limit?: number },
): Promise<KnowledgePassage[]> {
  const query = options.query.trim();
  if (!query || scope.length === 0) return [];
  const ids = scope.map((s) => s.spaceId);

  // Nothing to search: no embedding call, no cost.
  const [entries, chunks] = await Promise.all([
    supabase.from("memory_entries").select("id").in("space_id", ids).eq("status", "active").limit(1),
    supabase.from("document_chunks").select("id").in("space_id", ids).limit(1),
  ]);
  if (!entries.data?.length && !chunks.data?.length) return [];

  const embedding = options.embedding !== undefined ? options.embedding : await embedQuery(supabase, ctx, options.embeddingQuery?.trim() || query);
  const limit = options.limit ?? MAX_PASSAGES;
  const { data } = await supabase.rpc("match_memory", {
    p_space_ids: ids,
    p_keywords: keywordQuery(query),
    p_embedding: embedding ?? undefined,
    p_embedding_model: embeddingModelName(),
    p_limit: limit + (options.excludeIds?.size ?? 0),
  });
  const rows = (data ?? []).filter((r) => ids.includes(r.space_id) && !options.excludeIds?.has(r.id)).slice(0, limit);
  if (rows.length === 0) return [];

  const clientNames = await clientNamesOf(supabase, scope);
  const spaceById = new Map(scope.map((s) => [s.spaceId, s]));

  return rows.map((r, i) => {
    const space = spaceById.get(r.space_id)!;
    return {
      position: i + 1,
      sourceType: r.source_type as KnowledgePassage["sourceType"],
      id: r.id,
      documentId: r.document_id,
      spaceId: r.space_id,
      spaceKind: space.kind,
      clientName: space.clientId ? (clientNames.get(space.clientId) ?? null) : null,
      title: r.title,
      content: r.content.length > PASSAGE_MAX_CHARS ? `${r.content.slice(0, PASSAGE_MAX_CHARS)}…` : r.content,
      page: r.page,
      charStart: r.char_start,
      charEnd: r.char_end,
      sourceDate: r.source_date,
      reason: "search" as const,
    };
  });
}
