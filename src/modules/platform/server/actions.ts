"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { resolveLocale } from "@/i18n/request";
import { invitationUrl, sendInvitationEmail } from "@/modules/organizations/server/invitation-email";

const optionalInt = z
  .union([z.literal(""), z.coerce.number().int().min(0)])
  .transform((v) => (v === "" ? null : v));

const planSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  priceLabel: z.string().trim().max(80).optional(),
  seatLimit: optionalInt,
  monthlyCredits: z.coerce.number().int().min(0),
  videoCredits: z.coerce.number().int().min(0),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

export async function savePlanAction(_: unknown, formData: FormData): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = planSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    priceLabel: formData.get("priceLabel") || undefined,
    seatLimit: formData.get("seatLimit") ?? "",
    monthlyCredits: formData.get("monthlyCredits") ?? 0,
    videoCredits: formData.get("videoCredits") ?? 0,
    isDefault: formData.get("isDefault") === "on",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { ok: false, error: "validation" };

  const supabase = await createClient();
  const row = {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    price_label: parsed.data.priceLabel ?? null,
    seat_limit: parsed.data.seatLimit === 0 ? null : parsed.data.seatLimit,
    monthly_credits: parsed.data.monthlyCredits,
    video_credits: parsed.data.videoCredits,
    is_default: parsed.data.isDefault,
    is_active: parsed.data.isActive,
  };
  if (parsed.data.isDefault) {
    // Only one default plan: clear the previous one first.
    await supabase.from("plans").update({ is_default: false }).eq("is_default", true);
  }
  const { error } = parsed.data.id
    ? await supabase.from("plans").update(row).eq("id", parsed.data.id)
    : await supabase.from("plans").insert(row);
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform", "layout");
  return { ok: true };
}

export async function createCompanyForCustomerAction(
  _: unknown,
  formData: FormData,
): Promise<ActionResult<{ link: string; emailSent: boolean }>> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), planId: z.uuid(), ownerEmail: z.email() })
    .safeParse({
      name: formData.get("name"),
      planId: formData.get("planId"),
      ownerEmail: String(formData.get("ownerEmail") ?? "").trim().toLowerCase(),
    });
  if (!parsed.success) return { ok: false, error: "validation" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_create_company", {
    p_name: parsed.data.name,
    p_plan: parsed.data.planId,
    p_owner_email: parsed.data.ownerEmail,
  });
  const row = data?.[0];
  if (error || !row) return { ok: false, error: toErrorCode(error) };

  const emailSent = await sendInvitationEmail(parsed.data.ownerEmail, row.token, await resolveLocale());
  revalidatePath("/platform");
  return { ok: true, data: { link: invitationUrl(row.token), emailSent } };
}

export async function updateCompanyForPlatformAction(input: {
  companyId: string;
  planId?: string;
  status?: "active" | "suspended";
}): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ companyId: z.uuid(), planId: z.uuid().optional(), status: z.enum(["active", "suspended"]).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_update_company", {
    p_company: parsed.data.companyId,
    p_plan: parsed.data.planId,
    p_status: parsed.data.status,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform");
  return { ok: true };
}
