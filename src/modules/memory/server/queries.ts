import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { myMemorySpaces, ownerNamesOf, type MemorySpace } from "./retrieval";

const KIND_ORDER = { company: 0, team: 1, project: 2, client: 3 } as const;

/** `clientName`: the name of the client, team or project the memory belongs to. */
export type SpaceSummary = MemorySpace & { clientName: string | null; clientArchived: boolean };

/** Memories the user can read: company first, then their team, projects and clients by name (RLS + SQL rights). */
export async function listMemorySpaces(ctx: MemberContext): Promise<SpaceSummary[]> {
  const supabase = await createClient();
  const spaces = await myMemorySpaces(supabase, ctx.active.companyId);
  const clientIds = spaces.filter((s) => s.clientId).map((s) => s.clientId!);
  const [names, { data: clients }] = await Promise.all([
    ownerNamesOf(supabase, spaces),
    clientIds.length
      ? supabase.from("clients").select("id, archived_at").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; archived_at: string | null }[] }),
  ]);
  const archived = new Set((clients ?? []).filter((c) => c.archived_at).map((c) => c.id));
  return spaces
    .map((s) => ({ ...s, clientName: names.get(s.spaceId) ?? null, clientArchived: s.clientId ? archived.has(s.clientId) : false }))
    .sort((a, b) => (a.kind === b.kind ? (a.clientName ?? "").localeCompare(b.clientName ?? "") : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
}

export async function listEntries(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memory_entries")
    .select(
      "id, title, content, kind, source_type, source_ref, created_at, updated_at, author:profiles!memory_entries_author_id_fkey(full_name, email), editor:profiles!memory_entries_updated_by_fkey(full_name, email)",
    )
    .eq("space_id", spaceId)
    // Current facts; replaced versions are listed as history.
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  return (data ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    content: e.content,
    sourceType: e.source_type as "manual" | "chat" | "ai_suggestion" | "promotion" | "auto" | "correction",
    kind: e.kind,
    conversationId: typeof (e.source_ref as { conversation_id?: unknown })?.conversation_id === "string" ? ((e.source_ref as { conversation_id: string }).conversation_id) : null,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    author: e.author?.full_name ?? e.author?.email ?? null,
    editor: e.editor?.full_name ?? e.editor?.email ?? null,
  }));
}
export type EntryRow = Awaited<ReturnType<typeof listEntries>>[number];

export async function listDocuments(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, filename, status, error_code, size_bytes, page_count, chunk_count, text_truncated, created_at, uploader:profiles!documents_uploaded_by_fkey(full_name, email)")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((d) => ({
    id: d.id,
    filename: d.filename,
    status: d.status as "processing" | "ready" | "failed",
    errorCode: d.error_code,
    sizeBytes: d.size_bytes,
    pageCount: d.page_count,
    chunkCount: d.chunk_count,
    truncated: d.text_truncated,
    createdAt: d.created_at,
    uploader: d.uploader?.full_name ?? d.uploader?.email ?? null,
  }));
}
export type DocumentRow = Awaited<ReturnType<typeof listDocuments>>[number];

/** Pending suggestions for a memory (visible to people who can write it, and to the proposer). */
export async function listSuggestions(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memory_suggestions")
    .select("id, kind, title, content, created_at, source_space_id, proposer:profiles!memory_suggestions_proposed_by_fkey(full_name, email)")
    .eq("space_id", spaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data ?? []).map((s) => ({
    id: s.id,
    kind: s.kind as "new_entry" | "promotion",
    title: s.title,
    content: s.content,
    createdAt: s.created_at,
    proposer: s.proposer?.full_name ?? s.proposer?.email ?? null,
  }));
}
export type SuggestionRow = Awaited<ReturnType<typeof listSuggestions>>[number];

export async function getDocument(documentId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, space_id, company_id, filename, status, extracted_text, text_truncated, page_count, created_at, uploader:profiles!documents_uploaded_by_fkey(full_name, email)")
    .eq("id", documentId)
    .maybeSingle();
  return data;
}

/** Projects exist in this database (false on a preview before the V1.1 migration: the section is hidden). */
export async function projectsAvailable(): Promise<boolean> {
  const { error } = await (await createClient()).from("projects").select("id", { head: true }).limit(1);
  return !error;
}
