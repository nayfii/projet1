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
  options: { clientId: string | null; query: string },
): Promise<KnowledgePassage[]> {
  const query = options.query.trim();
  if (!query) return [];
  const scope = conversationScope(await myMemorySpaces(supabase, ctx.active.companyId), options.clientId);
  if (scope.length === 0) return [];
  const ids = scope.map((s) => s.spaceId);

  // Nothing to search: no embedding call, no cost.
  const [entries, chunks] = await Promise.all([
    supabase.from("memory_entries").select("id").in("space_id", ids).limit(1),
    supabase.from("document_chunks").select("id").in("space_id", ids).limit(1),
  ]);
  if (!entries.data?.length && !chunks.data?.length) return [];

  const embedding = await embedQuery(supabase, ctx, query);
  const { data } = await supabase.rpc("match_memory", {
    p_space_ids: ids,
    p_keywords: keywordQuery(query),
    p_embedding: embedding ?? undefined,
    p_embedding_model: embeddingModelName(),
    p_limit: MAX_PASSAGES,
  });
  const rows = (data ?? []).filter((r) => ids.includes(r.space_id));
  if (rows.length === 0) return [];

  const clientIds = [...new Set(scope.filter((s) => s.clientId).map((s) => s.clientId!))];
  const { data: clients } = clientIds.length
    ? await supabase.from("clients").select("id, name").in("id", clientIds)
    : { data: [] as { id: string; name: string }[] };
  const clientNames = new Map((clients ?? []).map((c) => [c.id, c.name]));
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
    };
  });
}
