/**
 * Error codes shared by the database (raised by RPCs through private.fail) and the app.
 * Each code has a translation under "errors" in messages/*.json.
 */
export const ERROR_CODES = [
  "not_authenticated",
  "forbidden",
  "owner_only",
  "owner_protected",
  "already_member",
  "already_in_company",
  "seat_limit_reached",
  "invalid_email",
  "invalid_scopes",
  "invitation_invalid",
  "invitation_wrong_email",
  "company_suspended",
  "cannot_deactivate_self",
  "not_found",
  "validation",
  "email_send_failed",
  "email_rate_limited",
  "email_not_authorized",
  "invalid_models",
  "system_category",
  "category_exists",
  "already_decided",
  "term_exists",
  "no_client_access",
  "owner_must_transfer",
  "not_restricted",
  "no_team",
  "video_quota_exceeded",
  "render_in_progress",
  "render_invalid",
  "render_missing_file",
  "unknown",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function toErrorCode(error: { message?: string; code?: string } | null | undefined): ErrorCode {
  if (!error) return "unknown";
  const message = error.message ?? "";
  if ((ERROR_CODES as readonly string[]).includes(message)) return message as ErrorCode;
  // 42501 = insufficient privilege, raised by RLS "with check" violations.
  if (error.code === "42501") return "forbidden";
  return "unknown";
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: ErrorCode; fields?: Record<string, string> };
