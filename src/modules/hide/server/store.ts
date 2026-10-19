import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { HideCounts, HideMode, Span } from "../categories";
import type { ListTerm } from "../detectors/lists";

/**
 * AUDITED service-role module (docs/ARCHITECTURE.md §5) for Hide:
 * - reads the company's lists used for detection (all clients, employees' names, custom terms, which
 *   members cannot list themselves);
 * - reads and writes placeholder mappings (no policy lets users read them);
 * - stores what the model received for a user message or attachment (users cannot write it);
 * - logs masking events with counts per category only.
 * Callers must have authorised the user on the conversation with the user's own session first.
 */

export async function loadCompanyLists(
  companyId: string,
  accessibleClientIds: ReadonlySet<string>,
): Promise<{ terms: ListTerm[]; firstNames: string[] }> {
  const admin = createAdminClient();
  const [clients, terms, members] = await Promise.all([
    admin.from("clients").select("id, name").eq("company_id", companyId),
    admin.from("sensitive_terms").select("term, category").eq("company_id", companyId),
    admin.from("company_members").select("profile:profiles!company_members_user_id_fkey(full_name)").eq("company_id", companyId),
  ]);
  const list: ListTerm[] = [];
  // A client this person cannot access is still masked, as a plain sensitive term: the label must
  // not reveal that a restricted client with that name exists.
  for (const c of clients.data ?? []) list.push({ term: c.name, category: accessibleClientIds.has(c.id) ? "client" : "term" });
  for (const t of terms.data ?? []) list.push({ term: t.term, category: t.category as ListTerm["category"] });
  const firstNames: string[] = [];
  for (const m of members.data ?? []) {
    const name = m.profile?.full_name?.trim();
    if (!name) continue;
    if (name.includes(" ")) list.push({ term: name, category: "person" });
    firstNames.push(name.split(/\s+/)[0]);
  }
  return { terms: list, firstNames };
}

export type MappingRow = { valueHash: string; placeholder: string; category: string; ciphertext: string };

/** Gives new values their placeholders (atomic per conversation) and returns all of the conversation's mappings. */
export async function assignPlaceholders(
  conversationId: string,
  items: { category: string; hash: string; ciphertext: string }[],
): Promise<MappingRow[]> {
  const { data, error } = await createAdminClient().rpc("hide_assign_placeholders", {
    p_conversation: conversationId,
    p_items: items as unknown as Json,
  });
  if (error) throw new Error(`hide mapping failed: ${error.code}`);
  return (data ?? []).map((r) => ({ valueHash: r.value_hash, placeholder: r.placeholder, category: r.category, ciphertext: r.value_ciphertext }));
}

export async function saveMessageMask(
  messageId: string,
  mask: { maskedContent: string | null; modes: HideMode[]; counts: HideCounts | null; spans: Span[] | null },
): Promise<void> {
  const { error } = await createAdminClient()
    .from("messages")
    .update({ masked_content: mask.maskedContent, hide_modes: mask.modes, hide_counts: mask.counts as Json | null, hide_spans: mask.spans as Json | null })
    .eq("id", messageId);
  if (error) throw new Error(`hide message update failed: ${error.code}`);
}

export async function saveAttachmentMasks(masks: { id: string; maskedText: string }[]): Promise<void> {
  const admin = createAdminClient();
  for (const m of masks) {
    const { error } = await admin.from("conversation_attachments").update({ masked_text: m.maskedText }).eq("id", m.id);
    if (error) throw new Error(`hide attachment update failed: ${error.code}`);
  }
}

/** Activity log entry: how many items of each category were masked. Never the values. */
export async function logMaskingEvent(input: { companyId: string; userId: string; conversationId: string; counts: HideCounts; modes: HideMode[] }): Promise<void> {
  await createAdminClient()
    .from("audit_log")
    .insert({
      scope: "company",
      company_id: input.companyId,
      actor_id: input.userId,
      action: "hide.masked",
      target_type: "conversation",
      target_id: input.conversationId,
      metadata: { counts: input.counts as { [key: string]: number }, modes: input.modes },
    });
}
