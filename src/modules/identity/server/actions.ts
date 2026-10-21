"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { safeNextPath } from "@/lib/safe-redirect";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { resolveLocale } from "@/i18n/request";
import type { ActionResult } from "@/lib/errors";

const emailSchema = z.email().max(254);

export async function sendMagicLink(_: unknown, formData: FormData): Promise<ActionResult<{ email: string }>> {
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success) return { ok: false, error: "invalid_email" };
  const next = safeNextPath(String(formData.get("next") ?? "/"), publicEnv.appUrl);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      shouldCreateUser: true,
      // Through /auth/callback: it also signs in with Supabase's default email links (code flow).
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?via=email&next=${encodeURIComponent(next)}`,
      data: { locale: await resolveLocale() },
    },
  });
  if (error) return { ok: false, error: "email_send_failed" };
  return { ok: true, data: { email: email.data } };
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? "/"), publicEnv.appUrl);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/login?error=oauth_failed");
  redirect(data.url);
}

/** Changes the interface language; saved on the profile when signed in. */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) await supabase.from("profiles").update({ locale }).eq("id", user.id);
  revalidatePath("/", "layout");
}

export async function updateMyProfile(_: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ fullName: z.string().trim().min(1).max(120) })
    .safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) return { ok: false, error: "validation", fields: { fullName: "required" } };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", user.id);
  if (error) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return { ok: true };
}
