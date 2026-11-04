import "server-only";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserClient } from "@/lib/supabase/server";
import { platformAdminEmails } from "@/lib/env";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

/**
 * Runs once after a successful sign-in (e-mail link, password or Google):
 * - clears a password that was not set in Cendr (`profiles.password_set_at` empty): a password set
 *   by someone who created the account before its owner (without access to the mailbox) stops
 *   working once the owner signs in; a password the person chose in Cendr stays;
 * - grants platform admin rights to the emails listed in PLATFORM_ADMIN_EMAILS (verified emails only);
 * - records the sign-in in the company activity log;
 * - applies the user's saved language.
 */
export async function afterSignIn(supabase: UserClient, user: User) {
  if (!(await hasCendrPassword(user.id))) await createAdminClient().rpc("clear_user_password", { p_user: user.id });
  const email = user.email?.toLowerCase();
  if (email && user.email_confirmed_at && platformAdminEmails().has(email)) {
    const admin = createAdminClient();
    const { data: existing } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!existing) {
      await admin.from("platform_admins").insert({ user_id: user.id });
      await admin.from("audit_log").insert({
        scope: "platform",
        actor_id: user.id,
        action: "platform_admin.granted",
        target_type: "user",
        target_id: user.id,
      });
    }
  }

  await supabase.rpc("record_sign_in");

  const { data: profile } = await supabase.from("profiles").select("locale").eq("id", user.id).maybeSingle();
  if (isLocale(profile?.locale)) {
    (await cookies()).set(LOCALE_COOKIE, profile.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
}

/** Whether the account's password was chosen in Cendr (profile, welcome screen or reset link). */
export async function hasCendrPassword(userId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("profiles").select("password_set_at").eq("id", userId).maybeSingle();
  return Boolean(data?.password_set_at);
}

/**
 * Password sign-in: only a password chosen in Cendr opens the account. Any other one (set through the
 * Auth API before the owner ever signed in) is cleared and the session closed.
 */
export async function acceptPasswordSignIn(supabase: UserClient, user: User): Promise<boolean> {
  if (await hasCendrPassword(user.id)) return true;
  await createAdminClient().rpc("clear_user_password", { p_user: user.id });
  await supabase.auth.signOut();
  return false;
}
