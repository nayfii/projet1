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
]);

type EventLike = { action: string; target_id: string | null; metadata: Json };

export function describeEvent(
  event: EventLike,
  names: { people?: Map<string, string>; clientNames?: Map<string, string> },
): { key: ActivityKey; values: Record<string, string> } {
  const key = event.action.replace(/\./g, "_");
  const meta = (event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata : {}) as Record<string, Json>;
  const client = (event.target_id && names.clientNames?.get(event.target_id)) || "—";
  const person =
    (typeof meta.user_id === "string" && names.people?.get(meta.user_id)) ||
    (event.target_id && names.people?.get(event.target_id)) ||
    "—";
  return {
    key: KNOWN.has(key) ? (key as ActivityKey) : "other",
    values: {
      client,
      person,
      from: String(meta.from ?? ""),
      to: String(meta.to ?? ""),
      role: String(meta.role ?? ""),
      reason: String(meta.reason ?? ""),
      code: event.action,
    },
  };
}
