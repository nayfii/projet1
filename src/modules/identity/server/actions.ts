"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/auth/context";
import { publicEnv } from "@/lib/public-env";
import { safeNextPath } from "@/lib/safe-redirect";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { resolveLocale } from "@/i18n/request";
import type { ActionResult } from "@/lib/errors";
import {
  AMBIENT_COOKIE,
  APPEARANCE_COOKIE_MAX_AGE,
  MOTION_COOKIE,
  THEME_COOKIE,
  isAmbient,
  isMotion,
  isTheme,
} from "@/lib/theme";

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
  if (error) {
    // Metadata only (never the address): visible in the hosting logs to diagnose the mail service.
    console.warn(JSON.stringify({ event: "magic_link_failed", code: error.code ?? null, status: error.status ?? null }));
    if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit" || error.status === 429) {
      return { ok: false, error: "email_rate_limited" };
    }
    // Supabase's test mailer only writes to the project's team members.
    if (error.code === "email_address_not_authorized") return { ok: false, error: "email_not_authorized" };
    return { ok: false, error: "email_send_failed" };
  }
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

/**
 * Appearance is a per-device choice (interface, ambient background, motion): cookies read by the
 * root layout. The page already shows the change; this keeps it for the next visits.
 */
export async function setAppearance(input: { theme?: string; ambient?: string; motion?: string }) {
  const jar = await cookies();
  const options = { path: "/", maxAge: APPEARANCE_COOKIE_MAX_AGE, sameSite: "lax" as const };
  if (isTheme(input.theme)) jar.set(THEME_COOKIE, input.theme, options);
  if (isAmbient(input.ambient)) jar.set(AMBIENT_COOKIE, input.ambient, options);
  if (isMotion(input.motion)) jar.set(MOTION_COOKIE, input.motion, options);
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

/**
 * Where a person goes once their two-step code is accepted: our console for our team (also when they
 * belong to a company: the founder's request of 2026-11-09), the app otherwise.
 */
export async function twoStepDestinationAction(): Promise<"/platform" | "/"> {
  const ctx = await getAppContext();
  return ctx?.isPlatformAdmin ? "/platform" : "/";
}
