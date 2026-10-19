"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { AUTO_CATEGORIES, HIDE_MODES } from "../categories";

/** Company admin ("hide" scope): default modes and the categories Automatic masks. Re-checked in SQL. */
export async function saveHideSettingsAction(input: { modes: string[]; categories: string[] }): Promise<ActionResult> {
  const ctx = await memberOrNull("hide");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ modes: z.array(z.enum(HIDE_MODES)).max(3), categories: z.array(z.enum(AUTO_CATEGORIES)).max(AUTO_CATEGORIES.length) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_hide_settings", {
    p_company: ctx.active.companyId,
    p_modes: parsed.data.modes,
    p_categories: parsed.data.categories,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/hide");
  revalidatePath("/chat", "layout");
  return { ok: true };
}

const termSchema = z.object({ term: z.string().trim().min(2).max(200), category: z.enum(["client", "project", "file", "term"]) });

/** Adds a custom sensitive term (client nickname, project or file name…). The activity log keeps its category only. */
export async function addSensitiveTermAction(input: { term: string; category: string }): Promise<ActionResult> {
  const ctx = await memberOrNull("hide");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = termSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.from("sensitive_terms").insert({ company_id: ctx.active.companyId, term: parsed.data.term, category: parsed.data.category });
  if (error) return { ok: false, error: error.code === "23505" ? "term_exists" : toErrorCode(error) };
  revalidatePath("/admin/hide");
  return { ok: true };
}

export async function removeSensitiveTermAction(input: { termId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull("hide");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ termId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.from("sensitive_terms").delete().eq("id", parsed.data.termId).eq("company_id", ctx.active.companyId);
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/hide");
  return { ok: true };
}
