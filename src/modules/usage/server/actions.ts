"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull, platformAdminOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";

const credits = z.number().min(0).max(1_000_000_000).nullable();

/** Company admin ("quotas" scope): monthly credit limit applied to each person by default (null = none). */
export async function setDefaultUserQuotaAction(input: { credits: number | null }): Promise<ActionResult> {
  const ctx = await memberOrNull("quotas");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ credits }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_default_user_quota", {
    p_company: ctx.active.companyId,
    p_credits: parsed.data.credits as number,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/quotas");
  return { ok: true };
}

/** Company admin ("quotas" scope): personal limit for one member, e.g. to raise it (null = back to default). */
export async function setMemberQuotaAction(input: { userId: string; credits: number | null }): Promise<ActionResult> {
  const ctx = await memberOrNull("quotas");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ userId: z.uuid(), credits }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_member_quota", {
    p_company: ctx.active.companyId,
    p_user: parsed.data.userId,
    p_credits: parsed.data.credits as number,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/quotas");
  return { ok: true };
}

/** Platform admin: extra credits for a company for the current month ("raise the limit"). */
export async function grantCreditsAction(input: { companyId: string; credits: number; note?: string }): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ companyId: z.uuid(), credits: z.number().positive().max(1_000_000_000), note: z.string().trim().max(200).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_grant_credits", {
    p_company: parsed.data.companyId,
    p_credits: parsed.data.credits,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform");
  return { ok: true };
}
