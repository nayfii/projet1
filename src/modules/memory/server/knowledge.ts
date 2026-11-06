import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { myMemorySpaces } from "./retrieval";

/**
 * What Cendr knows, for people (Client Room brief, Consciousness hub). Read with the viewer's own
 * session: RLS shows only memories they may read, so these pages never reveal more than the AI would.
 */

export type KnownFact = {
  id: string;
  title: string;
  content: string;
  kind: string;
  date: string;
  sourceType: string;
  author: string | null;
  confirmedAt: string | null;
};

export type FactChange = { id: string; before: string; after: string | null; at: string };

const FACT_COLUMNS = "id, title, content, kind, effective_at, updated_at, created_at, source_type, confirmed_at, author:profiles!memory_entries_author_id_fkey(full_name, email)";

type FactRow = {
  id: string;
  title: string;
  content: string;
  kind: string;
  effective_at: string | null;
  updated_at: string;
  created_at: string;
  source_type: string;
  confirmed_at: string | null;
  author: { full_name: string | null; email: string } | null;
};

const toFact = (e: FactRow): KnownFact => ({
  id: e.id,
  title: e.title,
  content: e.content,
  kind: e.kind,
  date: e.effective_at ?? e.updated_at,
  sourceType: e.source_type,
  author: e.author?.full_name ?? e.author?.email ?? null,
  confirmedAt: e.confirmed_at,
});

/** The living brief of a client: current facts by kind, and what changed lately (with the old value). */
export async function clientKnowledge(spaceId: string) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
  const [{ data: current }, { data: replaced }] = await Promise.all([
    supabase.from("memory_entries").select(FACT_COLUMNS).eq("space_id", spaceId).eq("status", "active").order("updated_at", { ascending: false }).limit(80),
    supabase
      .from("memory_entries")
      .select("id, content, superseded_at, superseded_by")
      .eq("space_id", spaceId)
      .eq("status", "superseded")
      .gte("superseded_at", since)
      .order("superseded_at", { ascending: false })
      .limit(10),
  ]);
  const facts = ((current ?? []) as FactRow[]).map(toFact);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const changes: FactChange[] = (replaced ?? []).map((r) => ({ id: r.id, before: r.content, after: r.superseded_by ? (byId.get(r.superseded_by)?.content ?? null) : null, at: r.superseded_at! }));
  const of = (...kinds: string[]) => facts.filter((f) => kinds.includes(f.kind));
  return {
    decisions: of("decision"),
    commitments: of("commitment"),
    facts: of("fact"),
    contacts: of("contact"),
    preferences: of("preference", "procedure"),
    notes: of("note"),
    changes,
    total: facts.length,
    learnedThisWeek: facts.filter((f) => f.sourceType === "auto" && Date.now() - new Date(f.date).getTime() < 7 * 24 * 3600_000).length,
  };
}
export type ClientKnowledge = Awaited<ReturnType<typeof clientKnowledge>>;

/** Superseded versions of a memory's facts (history), newest first, with what replaced them. */
export async function listFactHistory(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memory_entries")
    .select("id, title, content, superseded_at, superseded_by")
    .eq("space_id", spaceId)
    .eq("status", "superseded")
    .order("superseded_at", { ascending: false })
    .limit(30);
  const next = [...new Set((data ?? []).map((h) => h.superseded_by).filter((id): id is string => Boolean(id)))];
  const { data: replacements } = next.length ? await supabase.from("memory_entries").select("id, content").in("id", next) : { data: [] as { id: string; content: string }[] };
  const after = new Map((replacements ?? []).map((r) => [r.id, r.content]));
  return (data ?? []).map((h) => ({ id: h.id, title: h.title, before: h.content, after: h.superseded_by ? (after.get(h.superseded_by) ?? null) : null, at: h.superseded_at! }));
}

export type ActivityItem = {
  id: string;
  kind: string;
  title: string;
  content: string;
  at: string;
  sourceType: string;
  status: string;
  where: { kind: "company" | "client"; clientName: string | null; spaceId: string };
  author: string | null;
};

/** The Consciousness hub: real counts, recent memory activity, what waits for this person. */
export async function consciousnessOverview(ctx: MemberContext) {
  const supabase = await createClient();
  const spaces = await myMemorySpaces(supabase, ctx.active.companyId);
  const ids = spaces.map((s) => s.spaceId);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const clientIds = spaces.filter((s) => s.clientId).map((s) => s.clientId!);
  const [{ data: recent }, { count: learnedWeek }, { data: proposals }, { data: requests }, { data: clients }] = await Promise.all([
    ids.length
      ? supabase
          .from("memory_entries")
          .select("id, space_id, kind, title, content, created_at, source_type, status, author:profiles!memory_entries_author_id_fkey(full_name, email)")
          .in("space_id", ids)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase.from("memory_entries").select("id", { count: "exact", head: true }).in("space_id", ids).eq("source_type", "auto").gte("created_at", weekAgo)
      : Promise.resolve({ count: 0 }),
    supabase
      .from("memory_suggestions")
      .select("id, space_id, kind, title, content, reason, created_at")
      .eq("company_id", ctx.active.companyId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("client_access_requests")
      .select("id, client_id, requester_id, reason, duration_days, status, created_at, decided_at, expires_at, client:clients(name), requester:profiles!client_access_requests_requester_id_fkey(full_name, email)")
      .eq("company_id", ctx.active.companyId)
      .order("created_at", { ascending: false })
      .limit(30),
    clientIds.length ? supabase.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const where = (spaceId: string) => {
    const s = spaces.find((x) => x.spaceId === spaceId);
    return { kind: s?.kind ?? "company", clientName: s?.clientId ? (clientName.get(s.clientId) ?? null) : null, spaceId } as ActivityItem["where"];
  };
  const activity: ActivityItem[] = (recent ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    content: e.content,
    at: e.created_at,
    sourceType: e.source_type,
    status: e.status,
    where: where(e.space_id),
    author: e.author?.full_name ?? e.author?.email ?? null,
  }));
  const allRequests = requests ?? [];
  return {
    stats: {
      facts: spaces.reduce((n, s) => n + s.entryCount, 0),
      documents: spaces.reduce((n, s) => n + s.documentCount, 0),
      clients: spaces.filter((s) => s.kind === "client" && s.entryCount + s.documentCount > 0).length,
      learnedThisWeek: learnedWeek ?? 0,
    },
    activity,
    proposals: (proposals ?? []).map((p) => ({ ...p, where: where(p.space_id) })),
    // Requests this person may decide (pending, not their own), and their own requests.
    toDecide: allRequests.filter((r) => r.status === "pending" && r.requester_id !== ctx.user.id),
    mine: allRequests.filter((r) => r.requester_id === ctx.user.id).slice(0, 5),
  };
}
export type ConsciousnessOverview = Awaited<ReturnType<typeof consciousnessOverview>>;
