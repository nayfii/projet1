"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";

/** Permissions admin ("permissions" scope; re-checked in SQL). */
export async function saveCategoryAction(input: { categoryId: string | null; name: string; description: string; members: string[] }): Promise<ActionResult> {
  const ctx = await memberOrNull("permissions");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ categoryId: z.uuid().nullable(), name: z.string().trim().min(1).max(80), description: z.string().trim().max(300), members: z.array(z.uuid()).max(500) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_category", {
    p_company: ctx.active.companyId,
    p_category: parsed.data.categoryId as string,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_members: parsed.data.members,
  });
  if (error) return { ok: false, error: error.code === "23505" ? "category_exists" : toErrorCode(error) };
  revalidatePath("/admin/permissions");
  return { ok: true };
}

export async function deleteCategoryAction(input: { categoryId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull("permissions");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ categoryId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_category", { p_company: ctx.active.companyId, p_category: parsed.data.categoryId });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/permissions");
  return { ok: true };
}

export async function setSpaceGrantsAction(input: { spaceId: string; read: string[]; write: string[] }): Promise<ActionResult> {
  const ctx = await memberOrNull("permissions");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ spaceId: z.uuid(), read: z.array(z.uuid()).max(100), write: z.array(z.uuid()).max(100) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_space_grants", { p_space: parsed.data.spaceId, p_read: parsed.data.read, p_write: parsed.data.write });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/permissions");
  revalidatePath("/memory", "layout");
  return { ok: true };
}
