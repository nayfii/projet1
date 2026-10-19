import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { listMembers } from "@/modules/organizations/server/queries";
import { listClients } from "@/modules/clients/server/queries";
import { HANDOVER_SECTIONS, type HandoverSections } from "./handover";

export type Participant = { userId: string; name: string; email: string; avatarUrl: string | null; role: "owner" | "participant"; visibleFromSeq: number };
export type Colleague = { userId: string; name: string; email: string; avatarUrl: string | null; expertise: string[] };
export type Handover = {
  id: string;
  kind: "conversation" | "client";
  fromName: string | null;
  createdAt: string;
  editedAt: string | null;
  aiGenerated: boolean;
  sections: HandoverSections;
};

/** The conversation's participants (RLS: only its participants can list them). */
export async function getConversationPeople(conversationId: string): Promise<Participant[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversation_participants")
    .select("user_id, role, visible_from_seq, joined_at, profile:profiles!conversation_participants_user_id_fkey(full_name, email, avatar_url)")
    .eq("conversation_id", conversationId)
    .order("joined_at");
  return (data ?? []).map((p) => ({
    userId: p.user_id,
    name: p.profile?.full_name ?? p.profile?.email ?? "?",
    email: p.profile?.email ?? "",
    avatarUrl: p.profile?.avatar_url ?? null,
    role: p.role as Participant["role"],
    visibleFromSeq: p.visible_from_seq,
  }));
}

/**
 * Colleagues who could join a conversation (or receive a transfer): active members, and for a
 * conversation about a restricted client only those with access to it. The database re-checks.
 */
export async function getEligibleColleagues(ctx: MemberContext, clientId: string | null): Promise<Colleague[]> {
  const [members, clients] = await Promise.all([listMembers(ctx.active.companyId), clientId ? listClients(ctx.active.companyId, { includeArchived: true }) : Promise.resolve([])]);
  const client = clientId ? clients.find((c) => c.id === clientId) : null;
  return members
    .filter((m) => m.status === "active" && m.userId !== ctx.user.id)
    .filter((m) => !client || client.visibility === "open" || m.role === "owner" || client.assignees.some((a) => a.userId === m.userId))
    .map((m) => ({ userId: m.userId, name: m.fullName ?? m.email, email: m.email, avatarUrl: m.avatarUrl, expertise: m.expertise }));
}

/** The latest handover file this person received for a conversation or a client (RLS: recipient only). */
export async function getMyHandover(target: { conversationId: string } | { clientId: string }): Promise<Handover | null> {
  const supabase = await createClient();
  let query = supabase
    .from("handovers")
    .select("id, kind, sections, ai_generated, created_at, edited_at, from:profiles!handovers_from_user_fkey(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(1);
  query = "conversationId" in target ? query.eq("conversation_id", target.conversationId) : query.eq("client_id", target.clientId);
  const { data } = await query.maybeSingle();
  if (!data) return null;
  const raw = (data.sections ?? {}) as Record<string, unknown>;
  return {
    id: data.id,
    kind: data.kind as Handover["kind"],
    fromName: data.from?.full_name ?? data.from?.email ?? null,
    createdAt: data.created_at,
    editedAt: data.edited_at,
    aiGenerated: data.ai_generated,
    sections: Object.fromEntries(HANDOVER_SECTIONS.map((k) => [k, typeof raw[k] === "string" ? (raw[k] as string) : ""])) as HandoverSections,
  };
}
