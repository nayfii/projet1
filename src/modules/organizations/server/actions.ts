"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/auth/context";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult, type ErrorCode } from "@/lib/errors";
import { resolveLocale } from "@/i18n/request";
import { ADMIN_SCOPES } from "../scopes";
import { invitationUrl, sendInvitationEmail } from "./invitation-email";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const expertiseList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
  );

// ─── Onboarding: company creation ───────────────────────────────────────────

export async function createCompanyAction(_: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ fullName: z.string().trim().min(1).max(120), companyName: z.string().trim().min(1).max(120) })
    .safeParse({ fullName: formData.get("fullName"), companyName: formData.get("companyName") });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0])] = "required";
    return { ok: false, error: "validation", fields };
  }

  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "not_authenticated" };
  const supabase = await createClient();

  await supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", ctx.user.id);
  const { error } = await supabase.rpc("create_company", {
    p_name: parsed.data.companyName,
    p_default_locale: await resolveLocale(),
  });
  if (error) return { ok: false, error: toErrorCode(error) };

  revalidatePath("/", "layout");
  redirect("/onboarding?step=company");
}

const companyProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  industry: optionalText(120),
  sizeRange: z.enum(["1-5", "6-10", "11-25", "26-50", "51-200", "200+"]).optional().or(z.literal("").transform(() => undefined)),
  website: optionalText(300),
  description: optionalText(2000),
});

export async function updateCompanyProfileAction(_: unknown, formData: FormData): Promise<ActionResult> {
  const ctx = await memberOrNull("company");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = companyProfileSchema.safeParse({
    name: formData.get("name"),
    industry: formData.get("industry") ?? undefined,
    sizeRange: formData.get("sizeRange") ?? undefined,
    website: formData.get("website") ?? undefined,
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "validation", fields: { name: "required" } };

  const supabase = await createClient();
  const { error } = await supabase
    .from("companies")
    .update({
      name: parsed.data.name,
      industry: parsed.data.industry ?? null,
      size_range: parsed.data.sizeRange ?? null,
      website: parsed.data.website ?? null,
      description: parsed.data.description ?? null,
    })
    .eq("id", ctx.active.companyId);
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function completeOnboardingAction(formData?: FormData) {
  const ctx = await memberOrNull("company");
  if (ctx) {
    const supabase = await createClient();
    await supabase
      .from("companies")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", ctx.active.companyId)
      .is("onboarding_completed_at", null);
  }
  revalidatePath("/", "layout");
  // Only known destinations: the home page, or the first conversation.
  redirect(formData?.get("next") === "/chat" ? "/chat" : "/");
}

// ─── Invitations ────────────────────────────────────────────────────────────

export type InviteOutcome = { email: string; ok: boolean; error?: ErrorCode; link?: string; emailSent?: boolean };

const inviteSchema = z.object({
  emails: z
    .string()
    .transform((v) =>
      Array.from(
        new Set(
          v
            .split(/[\s,;]+/)
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
        ),
      ),
    )
    .pipe(z.array(z.email()).min(1).max(50)),
  role: z.enum(["member", "admin"]).default("member"),
  scopes: z.array(z.enum(ADMIN_SCOPES)).default([]),
  jobTitle: optionalText(120),
  expertise: expertiseList,
});

export async function inviteMembersAction(_: unknown, formData: FormData): Promise<ActionResult<InviteOutcome[]>> {
  const ctx = await memberOrNull("members");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = inviteSchema.safeParse({
    emails: formData.get("emails") ?? "",
    role: formData.get("role") || undefined,
    scopes: formData.getAll("scopes").map(String),
    jobTitle: formData.get("jobTitle") ?? undefined,
    expertise: formData.get("expertise") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid_email", fields: { emails: "invalid" } };

  const supabase = await createClient();
  const locale = await resolveLocale();
  const outcomes: InviteOutcome[] = [];
  for (const email of parsed.data.emails) {
    const { data, error } = await supabase.rpc("create_invitation", {
      p_company: ctx.active.companyId,
      p_email: email,
      p_role: parsed.data.role,
      p_admin_scopes: parsed.data.role === "admin" ? parsed.data.scopes : [],
      p_job_title: parsed.data.jobTitle,
      p_expertise: parsed.data.expertise,
    });
    const row = data?.[0];
    if (error || !row) {
      outcomes.push({ email, ok: false, error: toErrorCode(error) });
      continue;
    }
    const emailSent = await sendInvitationEmail(email, row.token, locale);
    outcomes.push({ email, ok: true, emailSent, link: invitationUrl(row.token) });
  }

  revalidatePath("/admin/members");
  return { ok: true, data: outcomes };
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
  const ctx = await memberOrNull("members");
  if (!ctx) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation: invitationId });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/members");
  return { ok: true };
}

export async function acceptInvitationAction(input: { invitationId?: string; token?: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "not_authenticated" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", {
    p_invitation: input.invitationId,
    p_token: input.token,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

// ─── Members ────────────────────────────────────────────────────────────────

const memberUpdateSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["member", "admin"]).optional(),
  scopes: z.array(z.enum(ADMIN_SCOPES)).optional(),
  status: z.enum(["active", "deactivated"]).optional(),
  jobTitle: z.string().max(120).optional(),
  expertise: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

export async function updateMemberAction(input: z.input<typeof memberUpdateSchema>): Promise<ActionResult> {
  const ctx = await memberOrNull("members");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = memberUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_member", {
    p_company: ctx.active.companyId,
    p_user: parsed.data.userId,
    p_role: parsed.data.role,
    p_admin_scopes: parsed.data.scopes,
    p_status: parsed.data.status,
    p_job_title: parsed.data.jobTitle,
    p_expertise: parsed.data.expertise,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/members");
  return { ok: true };
}

export async function updateMyCardAction(_: unknown, formData: FormData): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ jobTitle: z.string().trim().max(120), expertise: expertiseList, optOut: z.boolean() })
    .safeParse({
      jobTitle: String(formData.get("jobTitle") ?? ""),
      expertise: formData.get("expertise") ?? "",
      optOut: formData.get("optOut") === "on",
    });
  if (!parsed.success) return { ok: false, error: "validation" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_member_card", {
    p_company: ctx.active.companyId,
    p_job_title: parsed.data.jobTitle,
    p_expertise: parsed.data.expertise,
    p_opt_out: parsed.data.optOut,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/profile");
  return { ok: true };
}
