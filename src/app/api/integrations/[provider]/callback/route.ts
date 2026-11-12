import { NextResponse } from "next/server";
import { memberOrNull } from "@/lib/auth/guards";
import { oauthClient, oauthRedirectUri } from "@/lib/env";
import { isProviderId, PROVIDERS, scopesFor } from "@/modules/integrations/providers";
import { canGovernIntegrations } from "@/modules/integrations/server/access";
import { exchangeCode } from "@/modules/integrations/server/oauth";
import { logIntegration, saveConnection, takeOAuthState } from "@/modules/integrations/server/store";

/**
 * The provider sends the person back here. The state must be the one we issued, unused, recent, and
 * issued to this same person in this same company; then the code is exchanged on our server and the
 * tokens are stored sealed. Nothing of the provider's answer is shown or logged.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/integrations/[provider]/callback">) {
  const back = (query: string) => NextResponse.redirect(new URL(`/integrations?${query}`, request.url));
  const member = await memberOrNull();
  if (!member) return NextResponse.redirect(new URL("/login", request.url));
  const { provider: id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const stateValue = params.get("state") ?? "";
  const state = stateValue.length >= 32 ? await takeOAuthState(stateValue) : null;
  if (!isProviderId(id) || !state || state.provider !== id || state.userId !== member.user.id || state.companyId !== member.active.companyId) return back("error=state");
  if (params.get("error")) return back("error=denied");
  if (state.scope === "company" && !canGovernIntegrations(member)) return back("error=forbidden");
  const provider = PROVIDERS[id];
  const client = oauthClient(provider.env);
  const code = params.get("code");
  if (!client || !code) return back("error=exchange_failed");
  try {
    const tokens = await exchangeCode(provider, client, { code, redirectUri: oauthRedirectUri(id), codeVerifier: state.codeVerifier, scopes: scopesFor(provider, state.apps) });
    const connectionId = await saveConnection({ companyId: state.companyId, ownerId: member.user.id, provider: id, scope: state.scope, apps: state.apps, tokens });
    await logIntegration(state.companyId, member.user.id, "integration.connected", connectionId, { provider: id, scope: state.scope, apps: state.apps });
    return back(`connected=${id}`);
  } catch {
    return back("error=exchange_failed");
  }
}
