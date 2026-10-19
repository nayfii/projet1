"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull, platformAdminOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { PROVIDER_IDS } from "../types";

const modelId = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,62}$/);

/** Company admin ("models" scope): allowed models, default model, Auto mode. Rules are re-checked in SQL. */
export async function saveModelSettingsAction(input: {
  allowed: string[];
  defaultModelId: string | null;
  autoEnabled: boolean;
}): Promise<ActionResult> {
  const ctx = await memberOrNull("models");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ allowed: z.array(modelId).min(1).max(50), defaultModelId: modelId.nullable(), autoEnabled: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_models" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_model_settings", {
    p_company: ctx.active.companyId,
    p_allowed: parsed.data.allowed,
    p_default: parsed.data.defaultModelId as string,
    p_auto: parsed.data.autoEnabled,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/models");
  revalidatePath("/chat", "layout");
  return { ok: true };
}

const num = z.coerce.number().min(0).max(1_000_000_000);

const platformModelSchema = z.object({
  id: modelId,
  isNew: z.boolean(),
  provider: z.enum(PROVIDER_IDS),
  apiModelId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(80),
  tier: z.enum(["fast", "balanced", "advanced"]),
  contextWindow: z.coerce.number().int().min(8000).max(10_000_000),
  maxOutputTokens: z.coerce.number().int().min(256).max(200_000),
  strengths: z.array(z.enum(["writing", "reasoning", "code", "long_context", "speed", "vision"])),
  supportsImages: z.boolean(),
  inputUsd: num,
  outputUsd: num,
  cachedUsd: num,
  inputCredits: num,
  outputCredits: num,
  cachedCredits: num,
  isEnabled: z.boolean(),
  defaultAllowed: z.boolean(),
});

/** Platform admin: catalogue entry, price estimates and credit rates (no hardcoded prices in the app). */
export async function savePlatformModelAction(_: unknown, formData: FormData): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = platformModelSchema.safeParse({
    id: formData.get("id"),
    isNew: formData.get("isNew") === "true",
    provider: formData.get("provider"),
    apiModelId: formData.get("apiModelId"),
    label: formData.get("label"),
    tier: formData.get("tier"),
    contextWindow: formData.get("contextWindow"),
    maxOutputTokens: formData.get("maxOutputTokens"),
    strengths: formData.getAll("strengths").map(String),
    supportsImages: formData.get("supportsImages") === "on",
    inputUsd: formData.get("inputUsd"),
    outputUsd: formData.get("outputUsd"),
    cachedUsd: formData.get("cachedUsd"),
    inputCredits: formData.get("inputCredits"),
    outputCredits: formData.get("outputCredits"),
    cachedCredits: formData.get("cachedCredits"),
    isEnabled: formData.get("isEnabled") === "on",
    defaultAllowed: formData.get("defaultAllowed") === "on",
  });
  if (!parsed.success) return { ok: false, error: "validation" };
  const d = parsed.data;
  const row = {
    provider: d.provider,
    api_model_id: d.apiModelId,
    label: d.label,
    tier: d.tier,
    context_window: d.contextWindow,
    max_output_tokens: d.maxOutputTokens,
    strengths: d.strengths,
    supports_images: d.supportsImages,
    input_usd_per_mtok: d.inputUsd,
    output_usd_per_mtok: d.outputUsd,
    cached_input_usd_per_mtok: d.cachedUsd,
    input_credits_per_mtok: d.inputCredits,
    output_credits_per_mtok: d.outputCredits,
    cached_input_credits_per_mtok: d.cachedCredits,
    is_enabled: d.isEnabled,
    default_allowed: d.defaultAllowed,
  };
  const supabase = await createClient();
  const { error } = d.isNew
    ? await supabase.from("ai_models").insert({ id: d.id, ...row, sort_order: 100 })
    : await supabase.from("ai_models").update(row).eq("id", d.id);
  if (error) return { ok: false, error: error.code === "23505" ? "validation" : toErrorCode(error) };
  revalidatePath("/platform/models");
  return { ok: true };
}
