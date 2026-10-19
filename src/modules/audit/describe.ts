import type { Json } from "@/lib/supabase/database.types";
import type messages from "../../../messages/fr.json";

export type ActivityKey = keyof typeof messages.activity.actions;

/** Audit action codes we know how to describe. Unknown codes fall back to "other". */
const KNOWN = new Set<string>([
  "company_created",
  "company_updated",
  "invitation_created",
  "invitation_revoked",
  "invitation_accepted",
  "member_updated",
  "auth_sign_in",
  "client_created",
  "client_visibility_changed",
  "client_archived",
  "client_restored",
  "client_deleted",
  "client_assigned",
  "client_unassigned",
  "plan_created",
  "plan_updated",
  "plan_deleted",
  "platform_admin_granted",
  "models_updated",
  "quota_default_updated",
  "quota_member_updated",
  "ai_request_blocked",
  "model_created",
  "model_updated",
  "model_deleted",
  "credits_granted",
  "memory_entry_created",
  "memory_entry_updated",
  "memory_entry_deleted",
  "memory_document_added",
  "memory_document_deleted",
  "memory_suggestion_approved",
  "memory_suggestion_rejected",
  "permissions_category_saved",
  "permissions_category_deleted",
  "permissions_grants_updated",
  "hide_masked",
  "hide_settings_updated",
  "hide_term_added",
  "hide_term_removed",
  "conversation_participant_added",
  "conversation_participant_left",
  "conversation_history_shared",
  "conversation_transferred",
  "client_transferred",
]);

type EventLike = { action: string; target_id: string | null; metadata: Json };

export function describeEvent(
  event: EventLike,
  names: { people?: Map<string, string>; clientNames?: Map<string, string>; hideCategory?: (category: string) => string },
): { key: ActivityKey; values: Record<string, string | number> } {
  const key = event.action.replace(/\./g, "_");
  const meta = (event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata : {}) as Record<string, Json>;
  const client = (event.target_id && names.clientNames?.get(event.target_id)) || "—";
  const person =
    (typeof meta.user_id === "string" && names.people?.get(meta.user_id)) ||
    (event.target_id && names.people?.get(event.target_id)) ||
    "—";
  // Hide events carry counts per category only, never values.
  const counts = (meta.counts && typeof meta.counts === "object" && !Array.isArray(meta.counts) ? meta.counts : {}) as Record<string, Json>;
  const hideCategory = names.hideCategory ?? ((c: string) => c);
  return {
    key: KNOWN.has(key) ? (key as ActivityKey) : "other",
    values: {
      client,
      person,
      from: String(meta.from ?? ""),
      to: String(meta.to ?? ""),
      role: String(meta.role ?? ""),
      reason: String(meta.reason ?? ""),
      kind: String(meta.kind ?? meta.source_type ?? ""),
      code: event.action,
      count: Object.values(counts).reduce<number>((n, v) => n + Number(v ?? 0), 0),
      categories: Object.keys(counts).map(hideCategory).join(", "),
      category: typeof meta.category === "string" ? hideCategory(meta.category) : "",
    },
  };
}
