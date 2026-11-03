"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { toolSchema } from "@/modules/agents/definitions";

/** Platform → Applis: the launch switches (video apps, Application Review Assistant). */
export async function setAppSwitchesAction(input: { video?: boolean; appReview?: boolean }): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = z.object({ video: z.boolean().optional(), appReview: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_app_switches", { p_video: parsed.data.video, p_app_review: parsed.data.appReview });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform/apps");
  return { ok: true };
}

const appSchema = toolSchema.pick({ name: true, description: true, department: true, instructions: true, input_fields: true, tools: true, memory_scope: true, output_format: true });

/** Platform → Applis: an app our team adds for every customer (created or edited). */
export async function savePlatformAppAction(input: { id: string | null; app: unknown; enabled: boolean }): Promise<ActionResult<{ id: string }>> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const id = input.id === null ? null : z.uuid().safeParse(input.id).data;
  const parsed = appSchema.safeParse(input.app);
  if (!parsed.success || id === undefined) return { ok: false, error: "validation" };
  const a = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_save_app", {
    p_id: id as string,
    p_name: a.name,
    p_department: a.department,
    p_description: a.description,
    p_instructions: a.instructions,
    p_fields: a.input_fields,
    p_output_format: a.output_format,
    p_memory_scope: a.memory_scope,
    p_tools: a.tools,
    p_enabled: input.enabled === true,
  });
  if (error || !data) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform/apps");
  return { ok: true, data: { id: data } };
}

export async function deletePlatformAppAction(id: string): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_delete_app", { p_id: id });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform/apps");
  return { ok: true };
}

/** Platform → Entreprises: sign-up by our invitation only (launch), or open to anyone signed in. */
export async function setOpenSignupAction(open: boolean): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_open_signup", { p_open: open === true });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform/companies");
  return { ok: true };
}

/** Platform → Modèles: what one web search costs in credits, and its estimated provider cost. */
export async function setWebSearchRateAction(input: { credits: number; costUsd: number }): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = z.object({ credits: z.number().min(0).max(100_000), costUsd: z.number().min(0).max(100) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("platform_set_web_search_rate", { p_credits: parsed.data.credits, p_cost_usd: parsed.data.costUsd });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/platform/models");
  return { ok: true };
}
