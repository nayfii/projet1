"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { resolveLocale } from "@/i18n/request";
import { invitationUrl, sendInvitationEmail } from "@/modules/organizations/server/invitation-email";
import { getProvider } from "@/modules/providers/server/registry";
import { PROVIDER_IDS, type ProviderErrorCode } from "@/modules/providers/types";

const optionalInt = z
  .union([z.literal(""), z.coerce.number().int().min(0)])
  .transform((v) => (v === "" ? null : v));

const planSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  priceLabel: z.string().trim().max(80).optional(),
  pricePerSeat: z
    .union([z.literal(""), z.coerce.number().min(0).max(100000)])
    .transform((v) => (v === "" ? null : Math.round(v * 100) / 100)),
  currency: z.enum(["EUR", "USD"]),
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
    pricePerSeat: String(formData.get("pricePerSeat") ?? "").replace(",", ".").trim(),
    currency: formData.get("currency") || "EUR",
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
    monthly_price_per_seat: parsed.data.pricePerSeat,
    price_currency: parsed.data.currency,
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

/** The exchange rate used to compare dollar AI costs with euro prices (empty clears it). */
export async function setExchangeRateAction(_: unknown, formData: FormData): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const raw = String(formData.get("usdToEur") ?? "").replace(",", ".").trim();
  const parsed = z.union([z.literal(""), z.coerce.number().gt(0).max(100)]).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  // The generated types miss that SQL accepts null here (it clears the rate).
  const { error } = await supabase.rpc("platform_set_exchange_rate", { p_usd_to_eur: (parsed.data === "" ? null : parsed.data) as number });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform", "layout");
  return { ok: true };
}

const TEST_TIMEOUT_MS = 30_000;

/**
 * Live check of one provider: a tiny request with no customer data, on its cheapest enabled model.
 * Our own cost (a few tokens), not counted against any company. Only the outcome is logged.
 */
export async function testProviderAction(input: {
  provider: string;
}): Promise<ActionResult<{ ok: boolean; code: ProviderErrorCode | null; latencyMs: number }>> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const provider = PROVIDER_IDS.find((p) => p === input.provider);
  if (!provider) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const adapter = getProvider(provider);

  let code: ProviderErrorCode | null = null;
  const started = Date.now();
  if (!adapter.isConfigured()) {
    code = "missing_key";
  } else {
    const { data: model } = await supabase
      .from("ai_models")
      .select("api_model_id")
      .eq("provider", provider)
      .eq("kind", "chat")
      .eq("is_enabled", true)
      .order("input_usd_per_mtok")
      .limit(1)
      .maybeSingle();
    if (!model) {
      code = "model_not_found";
    } else {
      let answered = false;
      try {
        for await (const event of adapter.stream(
          {
            apiModelId: model.api_model_id,
            system: "Health check. Reply with the single word OK.",
            messages: [{ role: "user", content: [{ type: "text", text: "OK?" }] }],
            maxOutputTokens: 256,
          },
          AbortSignal.timeout(TEST_TIMEOUT_MS),
        )) {
          if (event.type === "error") code = event.error.code;
          if (event.type === "text" || event.type === "done") answered = true;
        }
      } catch {
        code = "unknown";
      }
      if (!answered && !code) code = Date.now() - started >= TEST_TIMEOUT_MS ? "unavailable" : "unknown";
    }
  }
  const latencyMs = Date.now() - started;
  const ok = code === null;
  await supabase.rpc("platform_log_provider_test", { p_provider: provider, p_ok: ok, p_code: code as string, p_latency_ms: latencyMs });
  revalidatePath("/platform/health");
  return { ok: true, data: { ok, code, latencyMs } };
}
