"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";

/**
 * Personal memory (CLAUDE.md §11): notes the AI uses for this person only. The table's policy lets
 * nobody else read or write them — no colleague, Admin, Owner or platform team.
 */
const note = z.string().trim().min(1).max(500);

export async function addPersonalNoteAction(input: { content: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ content: note }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { data, error } = await (await createClient())
    .from("personal_memory")
    .insert({ company_id: ctx.active.companyId, content: parsed.data.content })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/profile");
  return { ok: true, data: { id: data.id } };
}

export async function updatePersonalNoteAction(input: { id: string; content: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ id: z.uuid(), content: note }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).from("personal_memory").update({ content: parsed.data.content }).eq("id", parsed.data.id);
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/profile");
  return { ok: true };
}

export async function deletePersonalNoteAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).from("personal_memory").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/profile");
  return { ok: true };
}
