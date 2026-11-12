import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { ProviderDef, ProviderId } from "../providers";

/**
 * OAuth 2.0 with each provider's official endpoints: the authorize address (with PKCE where the
 * provider supports it), the code exchange, the refresh, the revocation and the connected account.
 * No provider SDK: plain HTTPS, so every request is visible here and testable.
 */

export type OAuthClient = { clientId: string; clientSecret: string };

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  grantedScopes: string[];
  account: { id: string | null; label: string | null };
};

export class OAuthError extends Error {
  constructor(readonly code: "exchange_failed" | "refresh_failed" | "account_failed" | "invalid_grant") {
    super(code);
  }
}

const base64url = (b: Buffer) => b.toString("base64url");

export function newState(): string {
  return base64url(randomBytes(32));
}

export function newCodeVerifier(): string {
  return base64url(randomBytes(48));
}

export function codeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** Where the person is sent to allow access. */
export function authorizeUrl(provider: ProviderDef, client: OAuthClient, input: { redirectUri: string; state: string; scopes: string[]; codeVerifier: string }): string {
  const oauth = provider.oauth!;
  const url = new URL(oauth.authorizeUrl);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  if (oauth.scopeParam && input.scopes.length) url.searchParams.set(oauth.scopeParam, input.scopes.join(oauth.scopeSeparator));
  if (oauth.pkce) {
    url.searchParams.set("code_challenge", codeChallenge(input.codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(oauth.extraParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

async function tokenRequest(provider: ProviderDef, client: OAuthClient, params: Record<string, string>): Promise<Record<string, unknown>> {
  const oauth = provider.oauth!;
  const headers: Record<string, string> = { Accept: "application/json" };
  const body: Record<string, string> = { ...params };
  if (oauth.clientAuth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`;
  } else {
    body.client_id = client.clientId;
    body.client_secret = client.clientSecret;
  }
  let payload: string;
  if (oauth.tokenBody === "json") {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body).toString();
  }
  const res = await fetch(oauth.tokenUrl, { method: "POST", headers, body: payload, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Slack answers 200 with ok:false; the others use HTTP errors.
  if (!res.ok || json.ok === false || typeof json.access_token !== "string") {
    if (json.error === "invalid_grant") throw new OAuthError("invalid_grant");
    throw new OAuthError(params.grant_type === "refresh_token" ? "refresh_failed" : "exchange_failed");
  }
  return json;
}

function readTokens(provider: ProviderDef, json: Record<string, unknown>, previousRefresh: string | null, requested: string[]): Omit<TokenSet, "account"> {
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : Number(json.expires_in) || null;
  const scope = typeof json.scope === "string" ? json.scope : "";
  const granted = scope ? scope.split(/[ ,]+/).filter(Boolean) : requested;
  return {
    accessToken: json.access_token as string,
    // Some providers send a new refresh token on each refresh (Canva, Notion: single use); others keep the old one.
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : previousRefresh,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    grantedScopes: provider.id === "notion" ? [] : granted,
  };
}

/** The connected account, to show which mailbox or workspace a connection is. */
async function accountOf(provider: ProviderId, accessToken: string, json: Record<string, unknown>): Promise<TokenSet["account"]> {
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new OAuthError("account_failed");
    return (await res.json()) as Record<string, unknown>;
  };
  const str = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 200) : null);
  switch (provider) {
    case "google": {
      const me = await get("https://openidconnect.googleapis.com/v1/userinfo");
      return { id: str(me.sub), label: str(me.email) };
    }
    case "microsoft": {
      const me = await get("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName");
      return { id: str(me.id), label: str(me.mail) ?? str(me.userPrincipalName) };
    }
    case "slack": {
      const team = (json.team ?? {}) as Record<string, unknown>;
      return { id: str(team.id), label: str(team.name) };
    }
    case "notion":
      return { id: str(json.workspace_id), label: str(json.workspace_name) };
    case "canva": {
      const profile = await get("https://api.canva.com/rest/v1/users/me/profile");
      const me = await get("https://api.canva.com/rest/v1/users/me");
      const teamUser = (me.team_user ?? {}) as Record<string, unknown>;
      return { id: str(teamUser.user_id), label: str((profile.profile as Record<string, unknown> | undefined)?.display_name) };
    }
    default:
      return { id: null, label: null };
  }
}

/** The code the provider sent back, exchanged for tokens; then who the account is. */
export async function exchangeCode(provider: ProviderDef, client: OAuthClient, input: { code: string; redirectUri: string; codeVerifier: string; scopes: string[] }): Promise<TokenSet> {
  const params: Record<string, string> = { grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri };
  if (provider.oauth!.pkce) params.code_verifier = input.codeVerifier;
  const json = await tokenRequest(provider, client, params);
  const tokens = readTokens(provider, json, null, input.scopes);
  return { ...tokens, account: await accountOf(provider.id, tokens.accessToken, json) };
}

export async function refreshTokens(provider: ProviderDef, client: OAuthClient, refreshToken: string, scopes: string[]): Promise<Omit<TokenSet, "account">> {
  const json = await tokenRequest(provider, client, { grant_type: "refresh_token", refresh_token: refreshToken });
  return readTokens(provider, json, refreshToken, scopes);
}

/**
 * Asks the provider to cancel the tokens, where it offers that. Microsoft has no per-app revocation
 * endpoint: the tokens are deleted on our side and the person can remove the app from their account.
 */
export async function revokeTokens(provider: ProviderDef, client: OAuthClient, tokens: { accessToken: string; refreshToken: string | null }): Promise<boolean> {
  const url = provider.oauth?.revokeUrl;
  if (!url) return false;
  const token = tokens.refreshToken ?? tokens.accessToken;
  try {
    let res: Response;
    switch (provider.id) {
      case "google":
        res = await fetch(`${url}?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        break;
      case "slack":
        res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${tokens.accessToken}` } });
        break;
      case "notion":
        res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
          body: JSON.stringify({ token: tokens.accessToken }),
        });
        break;
      case "canva":
        res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
        });
        break;
      default:
        return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}
