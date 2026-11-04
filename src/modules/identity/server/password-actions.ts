"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { safeNextPath } from "@/lib/safe-redirect";
import type { ActionResult, ErrorCode } from "@/lib/errors";
import { newPasswordSchema, openedByRecentEmailLink } from "../password";
import { acceptPasswordSignIn, afterSignIn, hasCendrPassword } from "./after-sign-in";

const emailSchema = z.email().max(254);

function rateLimited(error: { code?: string; status?: number }): boolean {
  return error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit" || error.status === 429;
}

/** E-mail and password. One message for every refusal: it never tells whether an account exists. */
export async function signInWithPasswordAction(_: unknown, formData: FormData): Promise<ActionResult> {
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  const password = String(formData.get("password") ?? "");
  if (!email.success) return { ok: false, error: "invalid_email" };
  if (!password || password.length > 128) return { ok: false, error: "invalid_credentials" };
  const next = safeNextPath(String(formData.get("next") ?? "/"), publicEnv.appUrl);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error || !data.user) {
    // Metadata only (never the address).
    console.warn(JSON.stringify({ event: "password_sign_in_failed", code: error?.code ?? null, status: error?.status ?? null }));
    return { ok: false, error: error && rateLimited(error) ? "email_rate_limited" : "invalid_credentials" };
  }
  if (!(await acceptPasswordSignIn(supabase, data.user))) return { ok: false, error: "invalid_credentials" };
  await afterSignIn(supabase, data.user);
  redirect(next);
}

/** "Forgot password": always the same answer, whether or not the address has an account. */
export async function requestPasswordResetAction(_: unknown, formData: FormData): Promise<ActionResult<{ email: string }>> {
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success) return { ok: false, error: "invalid_email" };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${publicEnv.appUrl}/auth/callback?via=email&next=${encodeURIComponent("/reset-password")}`,
  });
  if (error) {
    console.warn(JSON.stringify({ event: "password_reset_failed", code: error.code ?? null, status: error.status ?? null }));
    if (rateLimited(error)) return { ok: false, error: "email_rate_limited" };
  }
  return { ok: true, data: { email: email.data } };
}

/**
 * Whether choosing a new password needs the current one: not when there is none yet, nor in the
 * 15 minutes after an e-mail link (sign-in or "forgot password"), which proves the mailbox.
 */
export async function needsCurrentPassword(): Promise<boolean | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  if (!(await hasCendrPassword(claims.sub))) return false;
  return !openedByRecentEmailLink(claims.amr, Math.floor(Date.now() / 1000));
}

/** Creates or changes the signed-in person's password (profile, welcome screen, reset link). */
export async function setPasswordAction(_: unknown, formData: FormData): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = formData.has("confirm") ? String(formData.get("confirm") ?? "") : password;
  const current = String(formData.get("current") ?? "");
  const error = await setPassword(password, confirm, current);
  if (error) return { ok: false, error, fields: { password: error } };
  revalidatePath("/", "layout");
  const next = formData.get("next");
  if (typeof next === "string" && next) redirect(safeNextPath(next, publicEnv.appUrl));
  return { ok: true };
}

async function setPassword(password: string, confirm: string, current: string): Promise<ErrorCode | null> {
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) return "weak_password";
  if (password !== confirm) return "password_mismatch";

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  if (!data?.claims?.sub || !email) return "not_authenticated";
  const needsCurrent = await needsCurrentPassword();
  if (needsCurrent) {
    if (!current) return "wrong_password";
    // Checked with a throwaway client (nothing stored), then that check's session is closed.
    const check = createSupabaseClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await check.auth.signInWithPassword({ email, password: current });
    if (verified.error) return verified.error.status === 429 ? "email_rate_limited" : "wrong_password";
    await check.auth.signOut({ scope: "local" });
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    console.warn(JSON.stringify({ event: "password_update_failed", code: error.code ?? null, status: error.status ?? null }));
    if (error.code === "same_password") return "same_password";
    if (error.code === "weak_password") return "weak_password";
    if (error.code === "reauthentication_needed") return "wrong_password";
    return "unknown";
  }
  const marked = await supabase.rpc("mark_password_set");
  return marked.error ? "unknown" : null;
}
