import "server-only";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/public-env";

export function invitationUrl(token: string) {
  return `${publicEnv.appUrl}/invite/${token}`;
}

/**
 * Sends the invitation email through Supabase Auth (local: Mailpit; production: the configured SMTP).
 * New addresses get the "invite" email, existing accounts a sign-in link. Both lead to /invite/<token>.
 * Returns false if no email could be sent: the inviter can still copy the link.
 */
export async function sendInvitationEmail(email: string, token: string, locale: string): Promise<boolean> {
  const redirectTo = invitationUrl(token);
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { locale } });
  if (!error) return true;

  const alreadyRegistered = error.code === "email_exists" || error.status === 422;
  if (!alreadyRegistered) return false;

  const plain = createPlainClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: otpError } = await plain.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  return !otpError;
}
