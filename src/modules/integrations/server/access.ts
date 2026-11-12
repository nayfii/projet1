import "server-only";
import { logEvent } from "@/lib/log";
import type { MemberContext } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { oauthClient } from "@/lib/env";
import { capability, isProviderId, PROVIDERS, scopesFor, type ProviderDef, type ProviderId } from "../providers";
import { integrationsConfigured } from "./crypto";
import { caller, EXECUTORS, ProviderCallError } from "./executors";
import { OAuthError, refreshTokens } from "./oauth";
import { loadConnection, loadTokens, logIntegration, markUsed, readDisabledProviders, saveTokens, setStatus, type ConnectionRow } from "./store";

/**
 * Who may connect, see and use what, and the one door every use goes through (`runCapability`):
 * the connection belongs to the person's company, is theirs (personal) or the company's, is active,
 * its provider is allowed by the company, and the capability's app was granted. Tokens are refreshed
 * here; a refused refresh marks the connection "expired" (reconnect).
 */

/** Owner, or an Admin with the "models" scope (AI and tools settings): company connections and governance. */
export function canGovernIntegrations(ctx: MemberContext): boolean {
  return ctx.active.role === "owner" || hasScope(ctx.active, "models");
}

export type ProviderAvailability = {
  id: ProviderId;
  ready: boolean;
  reason: "soon" | "not_configured" | "no_key" | "disabled" | null;
  /** The company's own choice, whatever our setup (the Owner's switch shows it). */
  companyDisabled: boolean;
};

/** Whether each provider can be connected here: built, set up by our team, allowed by the company. */
export async function providerAvailability(companyId: string): Promise<ProviderAvailability[]> {
  const disabled = new Set(await readDisabledProviders(companyId));
  const keyReady = integrationsConfigured();
  return Object.values(PROVIDERS).map((p) => {
    const reason = p.status === "soon" ? "soon" : !oauthClient(p.env) ? "not_configured" : !keyReady ? "no_key" : disabled.has(p.id) ? "disabled" : null;
    return { id: p.id, ready: reason === null, reason, companyDisabled: disabled.has(p.id) };
  });
}

/** May this person use this connection? (Read with our server's rights; the rules are checked here.) */
export async function usableConnection(ctx: MemberContext, connectionId: string): Promise<{ row: ConnectionRow; provider: ProviderDef } | null> {
  const row = await loadConnection(connectionId);
  if (!row || row.company_id !== ctx.active.companyId || !isProviderId(row.provider)) return null;
  if (row.scope === "personal" && row.owner_id !== ctx.user.id) return null;
  const availability = (await providerAvailability(ctx.active.companyId)).find((a) => a.id === row.provider);
  if (!availability?.ready) return null;
  return { row, provider: PROVIDERS[row.provider] };
}

export type RunError = "not_found" | "inactive" | "not_granted" | "expired" | "forbidden" | "rate_limited" | "provider_error" | "unsupported_file" | "validation";

/** Runs one capability with a connection. Write actions are logged (ids only); errors come back as codes. */
export async function runCapability(ctx: MemberContext, connectionId: string, capabilityId: string, input: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: RunError }> {
  const found = await usableConnection(ctx, connectionId);
  if (!found) return { ok: false, error: "not_found" };
  const { row, provider } = found;
  if (row.status === "revoked") return { ok: false, error: "not_found" };
  if (row.status === "expired") return { ok: false, error: "expired" };
  const cap = capability(provider, capabilityId);
  if (!cap || !row.apps.includes(cap.app)) return { ok: false, error: "not_granted" };
  const client = oauthClient(provider.env);
  const executor = EXECUTORS[provider.id]?.run[capabilityId];
  if (!client || !executor) return { ok: false, error: "inactive" };

  let tokens = await loadTokens(row.id);
  if (!tokens) return { ok: false, error: "expired" };
  const refresh = async () => {
    if (!tokens?.refreshToken) throw new OAuthError("refresh_failed");
    const next = await refreshTokens(provider, client, tokens.refreshToken, scopesFor(provider, row.apps));
    await saveTokens(row.id, next);
    tokens = { accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: next.expiresAt };
  };
  const started = performance.now();
  const done = (outcome: string) =>
    logEvent(outcome === "ok" ? "info" : "warn", "integration.call", { provider: provider.id, capability: cap.id, kind: cap.kind, outcome, ms: performance.now() - started });
  try {
    if (tokens.expiresAt && Date.parse(tokens.expiresAt) - Date.now() < 60_000) await refresh();
    const run = () => executor(caller(EXECUTORS[provider.id].base, tokens!.accessToken, EXECUTORS[provider.id].headers), input);
    let data: unknown;
    try {
      data = await run();
    } catch (error) {
      if (!(error instanceof ProviderCallError && error.code === "unauthorized" && tokens.refreshToken)) throw error;
      await refresh();
      data = await run();
    }
    await markUsed(row.id);
    if (cap.kind === "write") await logIntegration(ctx.active.companyId, ctx.user.id, "integration.used", row.id, { provider: provider.id, capability: cap.id });
    done("ok");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof OAuthError || (error instanceof ProviderCallError && error.code === "unauthorized")) {
      await setStatus(row.id, "expired", "token_refused");
      done("expired");
      return { ok: false, error: "expired" };
    }
    if (error instanceof ProviderCallError) {
      done(error.code);
      if (cap.kind === "write") await logIntegration(ctx.active.companyId, ctx.user.id, "integration.failed", row.id, { provider: provider.id, capability: cap.id, error: error.code });
      return { ok: false, error: error.code === "unauthorized" ? "expired" : error.code === "not_found" ? "not_found" : error.code };
    }
    if (error instanceof Error && error.name === "ZodError") return { ok: false, error: "validation" };
    done("provider_error");
    return { ok: false, error: "provider_error" };
  }
}

const PING: Partial<Record<ProviderId, string>> = {
  google: "https://openidconnect.googleapis.com/v1/userinfo",
  microsoft: "https://graph.microsoft.com/v1.0/me?$select=id",
  slack: "https://slack.com/api/auth.test",
  notion: "https://api.notion.com/v1/users/me",
  canva: "https://api.canva.com/rest/v1/users/me",
};

/** "Vérifier": the token still works (refreshed if possible); otherwise the connection is marked expired. */
export async function checkConnection(ctx: MemberContext, connectionId: string): Promise<"active" | "expired" | "not_found"> {
  const found = await usableConnection(ctx, connectionId);
  if (!found || found.row.status === "revoked") return "not_found";
  const { row, provider } = found;
  const client = oauthClient(provider.env);
  const tokens = await loadTokens(row.id);
  if (!client || !tokens) return "not_found";
  try {
    let access = tokens.accessToken;
    if (tokens.refreshToken) {
      const next = await refreshTokens(provider, client, tokens.refreshToken, scopesFor(provider, row.apps));
      await saveTokens(row.id, next);
      access = next.accessToken;
    }
    const url = PING[provider.id];
    if (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${access}`, ...(EXECUTORS[provider.id]?.headers ?? {}) }, cache: "no-store" });
      const body = provider.id === "slack" ? ((await res.json().catch(() => ({}))) as { ok?: boolean }) : null;
      if (!res.ok || body?.ok === false) throw new OAuthError("refresh_failed");
    }
    await setStatus(row.id, "active");
    return "active";
  } catch {
    await setStatus(row.id, "expired", "token_refused");
    return "expired";
  }
}
