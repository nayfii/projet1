"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";

/** Platform admin: video credits per second of video produced, per kind of render (no prices in code). */
export async function setRenderRatesAction(input: { motion: number; videoEdit: number }): Promise<ActionResult> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = z.object({ motion: z.number().min(0).max(100_000), videoEdit: z.number().min(0).max(100_000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  for (const [kind, value] of [
    ["motion", parsed.data.motion],
    ["video_edit", parsed.data.videoEdit],
  ] as const) {
    const { error } = await supabase.rpc("platform_set_render_rate", { p_kind: kind, p_credits_per_second: value });
    if (error) return { ok: false, error: toErrorCode(error) };
  }
  revalidatePath("/platform/models");
  return { ok: true };
}
