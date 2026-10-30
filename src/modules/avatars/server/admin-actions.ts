"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";

/** Platform admin: credits charged per avatar creation and its estimated provider cost (no prices in code). */
export async function setAvatarRateAction(input: { credits: number; costUsd: number }): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = z.object({ credits: z.number().min(0).max(100_000), costUsd: z.number().min(0).max(100) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("platform_set_avatar_rate", { p_credits: parsed.data.credits, p_cost_usd: parsed.data.costUsd });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform/models");
  return { ok: true };
}
