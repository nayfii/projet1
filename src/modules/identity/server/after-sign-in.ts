import "server-only";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserClient } from "@/lib/supabase/server";
import { platformAdminEmails } from "@/lib/env";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

/**
 * Runs once after a successful sign-in (magic link or Google):
 * - grants platform admin rights to the emails listed in PLATFORM_ADMIN_EMAILS (verified emails only);
 * - records the sign-in in the company activity log;
 * - applies the user's saved language.
 */
export async function afterSignIn(supabase: UserClient, user: User) {
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
