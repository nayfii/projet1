import { NextResponse } from "next/server";
import { memberOrNull } from "@/lib/auth/guards";
import { oauthClient, oauthRedirectUri } from "@/lib/env";
import { isProviderId, PROVIDERS, scopesFor } from "@/modules/integrations/providers";
import { canGovernIntegrations, providerAvailability } from "@/modules/integrations/server/access";
import { authorizeUrl, newCodeVerifier, newState } from "@/modules/integrations/server/oauth";
import { saveOAuthState } from "@/modules/integrations/server/store";

/**
 * Starts connecting an app: checks who may connect what, keeps a one-time state (and the PKCE
 * verifier, sealed) on our server, then sends the person to the provider's own consent screen.
 * ?apps=gmail,calendar (least privilege: only these apps' permissions) &scope=personal|company
 */
export async function GET(request: Request, ctx: RouteContext<"/api/integrations/[provider]/connect">) {
  const back = (error: string) => NextResponse.redirect(new URL(`/integrations?error=${error}`, request.url));
  const member = await memberOrNull();
  if (!member) return NextResponse.redirect(new URL("/login", request.url));
  const { provider: id } = await ctx.params;
  if (!isProviderId(id)) return back("not_found");
  const provider = PROVIDERS[id];
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") === "company" ? "company" : "personal";
  if (scope === "company" && !canGovernIntegrations(member)) return back("forbidden");
  const availability = (await providerAvailability(member.active.companyId)).find((a) => a.id === id);
  const client = oauthClient(provider.env);
  if (!availability?.ready || !client || !provider.oauth) return back(availability?.reason ?? "not_configured");
  const known = new Set(provider.apps.map((a) => a.id));
  const apps = provider.apps.length === 1 ? [provider.apps[0].id] : [...new Set((params.get("apps") ?? "").split(",").filter((a) => known.has(a)))];
  if (apps.length === 0) return back("no_app");

  const state = newState();
  const codeVerifier = newCodeVerifier();
  await saveOAuthState({ state, companyId: member.active.companyId, userId: member.user.id, provider: id, scope, apps, codeVerifier });
  return NextResponse.redirect(authorizeUrl(provider, client, { redirectUri: oauthRedirectUri(id), state, scopes: scopesFor(provider, apps), codeVerifier }));
}
