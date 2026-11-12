import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { listMemorySpaces } from "@/modules/memory/server/queries";
import { PERSONAL, type ImportDestination } from "../destinations";

/** Proposals not reviewed within this time are deleted (they are the person's data waiting for a decision). */
export const PENDING_DAYS = 30;

export type ImportSummary = {
  id: string;
  source: string;
  fileName: string;
  status: "analyzing" | "review" | "done";
  found: number;
  selected: number;
  analyzed: number;
  excludedPrivate: number;
  duplicates: number;
  proposed: number;
  saved: number;
  failed: number;
  pending: number;
  createdAt: string;
};

export type PendingProposal = {
  id: string;
  category: "professional" | "preference";
  level: "personal" | "team" | "company" | "client" | "project";
  target: string | null;
  title: string;
  content: string;
  sensitive: boolean;
  sourceDate: string | null;
};

/** Everything the import page needs, read with the person's own session (their imports only). */
export async function importPageData(ctx: MemberContext, selected: string | null) {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - PENDING_DAYS * 86_400_000).toISOString();
  await supabase.from("knowledge_import_items").delete().eq("user_id", ctx.user.id).eq("status", "pending").lt("created_at", cutoff);

  const [{ data: imports, error: missing }, { data: pendingRows }, spaces] = await Promise.all([
    supabase
      .from("knowledge_imports")
      .select("id, source, file_name, status, found, selected, analyzed, excluded_private, duplicates, proposed, saved, failed, created_at")
      .eq("company_id", ctx.active.companyId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("knowledge_import_items").select("import_id").eq("company_id", ctx.active.companyId).eq("status", "pending"),
    listMemorySpaces(ctx),
  ]);
  const pendingBy = new Map<string, number>();
  for (const r of pendingRows ?? []) pendingBy.set(r.import_id, (pendingBy.get(r.import_id) ?? 0) + 1);
  const history: ImportSummary[] = (imports ?? []).map((i) => ({
    id: i.id,
    source: i.source,
    fileName: i.file_name,
    status: i.status as ImportSummary["status"],
    found: i.found,
    selected: i.selected,
    analyzed: i.analyzed,
    excludedPrivate: i.excluded_private,
    duplicates: i.duplicates,
    proposed: i.proposed,
    saved: i.saved,
    failed: i.failed,
    pending: pendingBy.get(i.id) ?? 0,
    createdAt: i.created_at,
  }));

  const destinations: ImportDestination[] = [
    { id: PERSONAL, kind: "personal", name: null },
    ...spaces.filter((s) => s.canWrite && !s.clientArchived).map((s) => ({ id: s.spaceId, kind: s.kind, name: s.clientName })),
  ];

  // The import to review: the one asked for, or the latest with proposals waiting.
  const reviewId = (selected && history.some((h) => h.id === selected) ? selected : null) ?? history.find((h) => h.pending > 0)?.id ?? null;
  let proposals: PendingProposal[] = [];
  if (reviewId) {
    const { data } = await supabase
      .from("knowledge_import_items")
      .select("id, category, level, target_hint, title, content, sensitive, source_date")
      .eq("import_id", reviewId)
      .eq("status", "pending")
      .order("created_at");
    proposals = (data ?? []).map((p) => ({
      id: p.id,
      category: p.category as PendingProposal["category"],
      level: p.level as PendingProposal["level"],
      target: p.target_hint,
      title: p.title,
      content: p.content,
      sensitive: p.sensitive,
      sourceDate: p.source_date,
    }));
  }
  // A database without the V1.1 migration (a preview on the production database): not available there yet.
  return { ready: !missing, history, destinations, reviewId, proposals };
}

/** Whether the person has ever imported (the home page suggests it until then). */
export async function hasImported(ctx: MemberContext): Promise<boolean> {
  const { count, error } = await (await createClient()).from("knowledge_imports").select("id", { count: "exact", head: true }).eq("company_id", ctx.active.companyId);
  // A database without the V1.1 migration (preview): no suggestion.
  return error ? true : (count ?? 0) > 0;
}
