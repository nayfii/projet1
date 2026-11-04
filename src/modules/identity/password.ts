import { z } from "zod";

/**
 * The password rule (same as the Auth server's: supabase/config.toml): at least 10 characters, with
 * letters and digits. Long passphrases are welcome.
 */
export const PASSWORD_MIN_LENGTH = 10;

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(128)
  .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), "letters_digits");

/** An e-mail link proves the mailbox: for 15 minutes after one, a new password needs no current one. */
export const RECENT_EMAIL_LINK_SECONDS = 15 * 60;

/** How the Auth server names sessions opened by an e-mail link (sign-in, "forgot password", invitation). */
const EMAIL_LINK_METHODS = new Set(["otp", "magiclink", "recovery", "invite", "email/signup"]);

/** Whether this session was opened by an e-mail link (sign-in or "forgot password") a moment ago. */
export function openedByRecentEmailLink(amr: unknown, nowSeconds: number): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      EMAIL_LINK_METHODS.has(String((entry as { method?: unknown }).method)) &&
      typeof (entry as { timestamp?: unknown }).timestamp === "number" &&
      nowSeconds - (entry as { timestamp: number }).timestamp <= RECENT_EMAIL_LINK_SECONDS,
  );
}
