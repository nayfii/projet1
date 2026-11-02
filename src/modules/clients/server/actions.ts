"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { canRestrictClients } from "@/lib/auth/context";
import { getLocale } from "next-intl/server";
import { clientSummary, type ClientSummary } from "./summary";
import { purgeClientDocumentFiles } from "./purge-files";
import { toErrorCode, type ActionResult } from "@/lib/errors";

const clientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  visibility: z.enum(["open", "restricted"]).default("open"),
  sector: z.string().trim().max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  assignees: z.array(z.uuid()).max(100).default([]),
});

function revalidateClients() {
  revalidatePath("/clients");
  revalidatePath("/admin/clients");
}

/**
 * Anyone in the company creates an open client (CLAUDE.md §11); a restricted one needs client
 * management (Owner, client Admins) or the Manager role. Re-checked by the clients policy.
 */
export async function createClientAction(_: unknown, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    visibility: formData.get("visibility") || undefined,
    sector: formData.get("sector") || undefined,
    description: formData.get("description") || undefined,
    assignees: formData.getAll("assignees").map(String),
  });
  if (!parsed.success) return { ok: false, error: "validation", fields: { name: "required" } };
  if (parsed.data.visibility === "restricted" && !canRestrictClients(ctx.active)) return { ok: false, error: "forbidden" };

  const supabase = await createClient();
  // The id is ours: a restricted client is only readable once its creator is assigned (by a trigger).
  const data = { id: randomUUID() };
  const { error } = await supabase.from("clients").insert({
    id: data.id,
    company_id: ctx.active.companyId,
    name: parsed.data.name,
    visibility: parsed.data.visibility,
    sector: parsed.data.sector ?? null,
    description: parsed.data.description ?? null,
    created_by: ctx.user.id,
  });
  if (error) return { ok: false, error: toErrorCode(error) };

  if (parsed.data.visibility === "restricted" && parsed.data.assignees.length > 0) {
    const { error: assignError } = await supabase.from("client_assignments").insert(
      parsed.data.assignees.map((userId) => ({
        client_id: data.id,
        company_id: ctx.active.companyId,
        user_id: userId,
        assigned_by: ctx.user.id,
      })),
    );
    if (assignError) return { ok: false, error: toErrorCode(assignError) };
  }
  revalidateClients();
  return { ok: true, data: { id: data.id } };
}

export async function updateClientAction(input: {
  clientId: string;
  name?: string;
  sector?: string | null;
  description?: string | null;
  visibility?: "open" | "restricted";
  archived?: boolean;
}): Promise<ActionResult> {
  const ctx = await memberOrNull("clients");
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({
      clientId: z.uuid(),
      name: z.string().trim().min(1).max(160).optional(),
      sector: z.string().trim().max(120).nullable().optional(),
      description: z.string().trim().max(4000).nullable().optional(),
      visibility: z.enum(["open", "restricted"]).optional(),
      archived: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };

  const { clientId, archived, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("clients")
    .update(
      {
        ...fields,
        ...(archived === undefined ? {} : { archived_at: archived ? new Date().toISOString() : null }),
      },
      { count: "exact" },
    )
    .eq("id", clientId)
    .eq("company_id", ctx.active.companyId);
  if (error) return { ok: false, error: toErrorCode(error) };
  if (!count) return { ok: false, error: "not_found" };
  revalidateClients();
  return { ok: true };
}

/**
 * Gives or removes access to a restricted client: client Admins for everyone, Managers for their own
 * team on clients they can open (client_assignments policies decide).
 */
export async function setClientAssignmentAction(input: {
  clientId: string;
  userId: string;
  assigned: boolean;
}): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx || !canRestrictClients(ctx.active)) return { ok: false, error: "forbidden" };
  const parsed = z.object({ clientId: z.uuid(), userId: z.uuid(), assigned: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };

  const supabase = await createClient();
  const { error, count } = parsed.data.assigned
    ? await supabase.from("client_assignments").insert({
        client_id: parsed.data.clientId,
        company_id: ctx.active.companyId,
        user_id: parsed.data.userId,
        assigned_by: ctx.user.id,
      })
    : await supabase
        .from("client_assignments")
        .delete({ count: "exact" })
        .eq("client_id", parsed.data.clientId)
        .eq("user_id", parsed.data.userId);
  if (error && error.code !== "23505") return { ok: false, error: toErrorCode(error) };
  if (!error && !parsed.data.assigned && !count) return { ok: false, error: "forbidden" };
  revalidateClients();
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return { ok: true };
}

/** Deletes an archived client for good: the Owner only, retyping its name (checked again by delete_client). */
export async function deleteClientAction(input: { clientId: string; confirmName: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx || ctx.active.role !== "owner") return { ok: false, error: "owner_only" };
  const parsed = z.object({ clientId: z.uuid(), confirmName: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { data: paths, error } = await (await createClient()).rpc("delete_client", {
    p_client: parsed.data.clientId,
    p_confirm_name: parsed.data.confirmName,
  });
  if (error) return { ok: false, error: toErrorCode(error) };
  await purgeClientDocumentFiles(paths ?? []);
  revalidateClients();
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The short brief at the top of a client's page, made from what this person may open (cached per person). */
export async function clientSummaryAction(input: { clientId: string; refresh?: boolean }): Promise<ClientSummary> {
  const ctx = await memberOrNull();
  if (!ctx) return { error: "unavailable" };
  const parsed = z.object({ clientId: z.uuid(), refresh: z.boolean().default(false) }).safeParse(input);
  if (!parsed.success) return { error: "unavailable" };
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  return clientSummary(await createClient(), ctx, parsed.data.clientId, locale, parsed.data.refresh);
}
