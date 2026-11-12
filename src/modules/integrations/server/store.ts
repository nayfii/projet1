import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderId } from "../providers";
import type { TokenSet } from "./oauth";
import { openToken, sealToken } from "./crypto";

/**
 * The only place that touches OAuth states and tokens (service role: no signed-in person can read
 * those tables). Callers check permissions first (server/access.ts). Tokens are sealed before writing.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export type ConnectionRow = {
  id: string;
  company_id: string;
  provider: string;
  scope: "personal" | "company";
  owner_id: string;
  account_label: string | null;
  apps: string[];
  granted_scopes: string[];
  status: "active" | "expired" | "revoked" | "error";
};

export async function saveOAuthState(row: { state: string; companyId: string; userId: string; provider: ProviderId; scope: "personal" | "company"; apps: string[]; codeVerifier: string }) {
  const admin = createAdminClient();
  // Old attempts of this person are cleaned on the way.
  await admin.from("integration_oauth_states").delete().lt("created_at", new Date(Date.now() - STATE_TTL_MS).toISOString());
  const { error } = await admin.from("integration_oauth_states").insert({
    state: row.state,
    company_id: row.companyId,
    user_id: row.userId,
    provider: row.provider,
    scope: row.scope,
    apps: row.apps,
    code_verifier: sealToken(row.codeVerifier),
  });
  if (error) throw error;
}

/** The state comes back once: it is deleted as it is read, and refused when older than ten minutes. */
export async function takeOAuthState(state: string) {
  const { data } = await createAdminClient().from("integration_oauth_states").delete().eq("state", state).select().maybeSingle();
  if (!data || Date.now() - new Date(data.created_at).getTime() > STATE_TTL_MS) return null;
  return { companyId: data.company_id, userId: data.user_id, provider: data.provider, scope: data.scope as "personal" | "company", apps: data.apps, codeVerifier: openToken(data.code_verifier) };
}

/** A new connection, or the same person's live one for that provider renewed (reconnection). */
export async function saveConnection(input: { companyId: string; ownerId: string; provider: ProviderId; scope: "personal" | "company"; apps: string[]; tokens: TokenSet }): Promise<string> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("integration_connections")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("provider", input.provider)
    .eq("scope", input.scope)
    .eq("owner_id", input.ownerId)
    .neq("status", "revoked")
    .maybeSingle();
  const fields = {
    account_label: input.tokens.account.label,
    account_id: input.tokens.account.id,
    apps: input.apps,
    granted_scopes: input.tokens.grantedScopes,
    status: "active",
    last_error: null,
  };
  let id = existing?.id;
  if (id) {
    const { error } = await admin.from("integration_connections").update(fields).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("integration_connections")
      .insert({ company_id: input.companyId, provider: input.provider, scope: input.scope, owner_id: input.ownerId, ...fields })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert failed");
    id = data.id;
  }
  await saveTokens(id, input.tokens);
  return id;
}

export async function saveTokens(connectionId: string, tokens: { accessToken: string; refreshToken: string | null; expiresAt: string | null }) {
  const { error } = await createAdminClient()
    .from("integration_tokens")
    .upsert({
      connection_id: connectionId,
      access_token: sealToken(tokens.accessToken),
      refresh_token: tokens.refreshToken ? sealToken(tokens.refreshToken) : null,
      expires_at: tokens.expiresAt,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function loadConnection(connectionId: string): Promise<ConnectionRow | null> {
  const { data } = await createAdminClient()
    .from("integration_connections")
    .select("id, company_id, provider, scope, owner_id, account_label, apps, granted_scopes, status")
    .eq("id", connectionId)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

export async function loadTokens(connectionId: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null } | null> {
  const { data } = await createAdminClient().from("integration_tokens").select("access_token, refresh_token, expires_at").eq("connection_id", connectionId).maybeSingle();
  if (!data) return null;
  return { accessToken: openToken(data.access_token), refreshToken: data.refresh_token ? openToken(data.refresh_token) : null, expiresAt: data.expires_at };
}

export async function setStatus(connectionId: string, status: "active" | "expired" | "error", error: string | null = null) {
  await createAdminClient().from("integration_connections").update({ status, last_error: error }).eq("id", connectionId);
}

export async function markUsed(connectionId: string) {
  await createAdminClient().from("integration_connections").update({ last_used_at: new Date().toISOString() }).eq("id", connectionId);
}

/** Revoked: the tokens are deleted at once; the connection stays as history (who, when). */
export async function markRevoked(connectionId: string) {
  const admin = createAdminClient();
  await admin.from("integration_tokens").delete().eq("connection_id", connectionId);
  await admin.from("integration_connections").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", connectionId);
}

export async function setDisabledProviders(companyId: string, userId: string, disabled: string[]) {
  const { error } = await createAdminClient()
    .from("company_integration_settings")
    .upsert({ company_id: companyId, disabled_providers: disabled, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Company activity log: who connected, used or revoked what (ids and names only, never content). */
export async function logIntegration(companyId: string, actorId: string, action: "integration.connected" | "integration.revoked" | "integration.used" | "integration.failed" | "integration.settings", connectionId: string | null, metadata: Record<string, string | string[] | number | boolean | null>) {
  await createAdminClient().from("audit_log").insert({ scope: "company", company_id: companyId, actor_id: actorId, action, target_type: "integration", target_id: connectionId, metadata });
}
