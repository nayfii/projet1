"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { oauthClient } from "@/lib/env";
import type { ActionResult } from "@/lib/errors";
import { isProviderId, PROVIDER_IDS, PROVIDERS } from "../providers";
import { canGovernIntegrations, checkConnection, runCapability, type RunError } from "./access";
import { revokeTokens } from "./oauth";
import { loadConnection, loadTokens, logIntegration, markRevoked, setDisabledProviders } from "./store";

/**
 * Revoke: the person who made the connection, or the Owner / an Admin with the "models" scope (any
 * connection of their company). The provider is asked to cancel the tokens where it can; ours are
 * deleted in any case, so nothing can use the connection afterwards.
 */
export async function revokeConnectionAction(input: { connectionId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.connectionId);
  if (!id.success) return { ok: false, error: "validation" };
  const row = await loadConnection(id.data);
  if (!row || row.company_id !== ctx.active.companyId || row.status === "revoked") return { ok: false, error: "not_found" };
  if (row.owner_id !== ctx.user.id && !canGovernIntegrations(ctx)) return { ok: false, error: "forbidden" };
  if (isProviderId(row.provider)) {
    const provider = PROVIDERS[row.provider];
    const client = oauthClient(provider.env);
    const tokens = await loadTokens(row.id).catch(() => null);
    if (client && tokens) await revokeTokens(provider, client, tokens);
  }
  await markRevoked(row.id);
  await logIntegration(ctx.active.companyId, ctx.user.id, "integration.revoked", row.id, { provider: row.provider, scope: row.scope, by_owner: row.owner_id === ctx.user.id });
  revalidatePath("/integrations");
  return { ok: true };
}

export async function checkConnectionAction(input: { connectionId: string }): Promise<ActionResult<{ status: "active" | "expired" }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.connectionId);
  if (!id.success) return { ok: false, error: "validation" };
  const status = await checkConnection(ctx, id.data);
  if (status === "not_found") return { ok: false, error: "not_found" };
  revalidatePath("/integrations");
  return { ok: true, data: { status } };
}

/** The Owner (or an Admin with the "models" scope) allows or switches off a provider for the whole company. */
export async function setProviderEnabledAction(input: { provider: string; enabled: boolean }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx || !canGovernIntegrations(ctx)) return { ok: false, error: "forbidden" };
  const parsed = z.object({ provider: z.enum(PROVIDER_IDS), enabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { createClient } = await import("@/lib/supabase/server");
  const { data } = await (await createClient()).from("company_integration_settings").select("disabled_providers").eq("company_id", ctx.active.companyId).maybeSingle();
  const disabled = new Set(data?.disabled_providers ?? []);
  if (parsed.data.enabled) disabled.delete(parsed.data.provider);
  else disabled.add(parsed.data.provider);
  await setDisabledProviders(ctx.active.companyId, ctx.user.id, [...disabled]);
  await logIntegration(ctx.active.companyId, ctx.user.id, "integration.settings", null, { provider: parsed.data.provider, enabled: parsed.data.enabled });
  revalidatePath("/integrations");
  return { ok: true };
}

/** Reads through a connection from the app (file picker): search, then read one file. Read capabilities only. */
export async function readFromAppAction(input: { connectionId: string; capability: string; input: unknown }): Promise<{ ok: true; data: unknown } | { ok: false; error: RunError | "forbidden" }> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ connectionId: z.uuid(), capability: z.string().regex(/^[a-z_]+\.(search|read|events|designs|channels)$/) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  return runCapability(ctx, parsed.data.connectionId, parsed.data.capability, input.input);
}
