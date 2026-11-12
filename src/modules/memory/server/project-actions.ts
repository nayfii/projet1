"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { toErrorCode, type ActionResult } from "@/lib/errors";

const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  clientId: z.uuid().nullable(),
});

/**
 * Starts a project (its memory is created with it, in the database). Any member may, alone or for a client
 * they can open; the database checks both (projects_insert policy).
 */
export async function createProjectAction(input: z.input<typeof projectSchema>): Promise<ActionResult<{ spaceId: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .insert({ company_id: ctx.active.companyId, name: parsed.data.name, description: parsed.data.description, client_id: parsed.data.clientId })
    .select("id")
    .single();
  if (error || !project) return { ok: false, error: toErrorCode(error) };
  const { data: space } = await supabase.from("memory_spaces").select("id").eq("project_id", project.id).single();
  if (!space) return { ok: false, error: "unknown" };
  revalidatePath("/memory");
  return { ok: true, data: { spaceId: space.id } };
}
