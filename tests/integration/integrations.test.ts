import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, createCompany, createUser, makePlatformAdmin, sql, type TestUser } from "../helpers/supabase";
import type { MemberContext } from "@/lib/auth/guards";

/**
 * Integrations (CLAUDE.md §12) against the real database and RLS. The PROVIDER is simulated at the
 * network level: requests to Google's endpoints get canned answers, everything else (our database) goes
 * through. The OAuth routes and the actions run as the signed-in person.
 *
 * Company "Lumen": Owner (governs), Alice and Bob (members). Another company: Eve. Our team: Pat.
 */

vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client");
vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-secret");
vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", "integration-test-key-0123456789-abcdef");
vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");

const state = vi.hoisted(() => ({ member: null as null | Record<string, unknown>, client: null as unknown, tokenCalls: 0, refreshFails: false }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/auth/guards", () => ({ memberOrNull: async () => state.member }));

const realFetch = globalThis.fetch;
const google = (url: string, init?: RequestInit): Response | null => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    state.tokenCalls++;
    const body = new URLSearchParams(String(init?.body));
    if (body.get("grant_type") === "refresh_token") return state.refreshFails ? new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) : ok({ access_token: "at-google-2", expires_in: 3600 });
    return ok({ access_token: "at-google-secret", refresh_token: "rt-google-secret", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.readonly" });
  }
  if (url.startsWith("https://oauth2.googleapis.com/revoke")) return ok({});
  if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return ok({ sub: "g-1", email: "alice@lumen.test" });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) return ok({ messages: [{ id: "m1" }] });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1")) return ok({ id: "m1", snippet: "Le devis est validé", payload: { headers: [{ name: "Subject", value: "Devis" }] } });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")) return ok({ id: "sent-1" });
  return null;
};

const { GET: connect } = await import("@/app/api/integrations/[provider]/connect/route");
const { GET: callback } = await import("@/app/api/integrations/[provider]/callback/route");
const { runCapability } = await import("@/modules/integrations/server/access");
const { revokeConnectionAction, setProviderEnabledAction } = await import("@/modules/integrations/server/actions");

let owner: TestUser, alice: TestUser, bob: TestUser, eve: TestUser, pat: TestUser;
let company: string, eveCompany: string;

const ctxOf = (user: TestUser, role: "owner" | "member" = "member", companyId = company) =>
  ({ user: { id: user.id, email: user.email }, active: { companyId, role, adminScopes: [] }, profile: { fullName: null } }) as unknown as MemberContext;

function as(user: TestUser, role: "owner" | "member" = "member", companyId = company) {
  state.member = ctxOf(user, role, companyId) as unknown as Record<string, unknown>;
  state.client = user.client;
}

const params = (provider: string) => ({ params: Promise.resolve({ provider }) }) as never;

/** Connects Google for `user` through our routes and the (simulated) consent screen. */
async function connectGoogle(user: TestUser, role: "owner" | "member", query: string) {
  as(user, role);
  const start = await connect(new Request(`https://app.test/api/integrations/google/connect?${query}`), params("google"));
  const to = new URL(start.headers.get("location")!);
  if (to.origin !== "https://accounts.google.com") return { start: to, back: null as URL | null };
  const back = await callback(new Request(`https://app.test/api/integrations/google/callback?code=abc&state=${to.searchParams.get("state")}`), params("google"));
  return { start: to, back: new URL(back.headers.get("location")!) };
}

const connectionsOf = (user: TestUser) => user.client.from("integration_connections").select("id, owner_id, scope, status, account_label").eq("company_id", company);

let aliceConnection: string;
let companyConnection: string;

beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return google(url, init) ?? realFetch(input, init);
  });
  [owner, alice, bob, eve, pat] = await Promise.all([createUser("in-owner", "Owner"), createUser("in-alice", "Alice"), createUser("in-bob", "Bob"), createUser("in-eve", "Eve"), createUser("in-pat", "Pat")]);
  company = await createCompany(owner, "Lumen");
  eveCompany = await createCompany(eve, "Ailleurs");
  for (const u of [alice, bob]) await addMember(owner, company, u);
  await makePlatformAdmin(pat);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("connecting with OAuth", () => {
  it("sends the person to Google with only the chosen app's permissions and PKCE, then stores the connection", async () => {
    const { start, back } = await connectGoogle(alice, "member", "scope=personal&apps=gmail");
    expect(start.searchParams.get("scope")).toContain("gmail.readonly");
    expect(start.searchParams.get("scope")).not.toMatch(/calendar|drive/);
    expect(start.searchParams.get("code_challenge_method")).toBe("S256");
    expect(start.searchParams.get("redirect_uri")).toBe("https://app.test/api/integrations/google/callback");
    expect(back?.search).toBe("?connected=google");
    const [row] = (await connectionsOf(alice)).data!;
    expect(row).toMatchObject({ owner_id: alice.id, scope: "personal", status: "active", account_label: "alice@lumen.test" });
    aliceConnection = row.id;
  });

  it("stores the tokens sealed, in a table nobody signed in can read", async () => {
    const [stored] = await sql<{ access_token: string; refresh_token: string }>("select access_token, refresh_token from public.integration_tokens where connection_id = $1", [aliceConnection]);
    expect(stored.access_token).toMatch(/^v1\./);
    expect(stored.access_token).not.toContain("at-google-secret");
    expect(stored.refresh_token).not.toContain("rt-google-secret");
    for (const user of [alice, owner]) {
      const { data } = await user.client.from("integration_tokens").select("*");
      expect(data ?? []).toEqual([]);
      expect((await user.client.from("integration_oauth_states").select("*")).data ?? []).toEqual([]);
    }
  });

  it("refuses a replayed or foreign state, and a member connecting for the whole company", async () => {
    as(alice);
    const start = await connect(new Request("https://app.test/api/integrations/google/connect?scope=personal&apps=calendar"), params("google"));
    const stateValue = new URL(start.headers.get("location")!).searchParams.get("state")!;
    as(bob);
    const stolen = await callback(new Request(`https://app.test/api/integrations/google/callback?code=x&state=${stateValue}`), params("google"));
    expect(new URL(stolen.headers.get("location")!).search).toBe("?error=state");
    as(alice);
    const replay = await callback(new Request(`https://app.test/api/integrations/google/callback?code=x&state=${stateValue}`), params("google"));
    expect(new URL(replay.headers.get("location")!).search).toBe("?error=state");
    const { start: forbidden } = await connectGoogle(bob, "member", "scope=company&apps=gmail");
    expect(forbidden.search).toBe("?error=forbidden");
  });

  it("lets the Owner connect a shared account for the company", async () => {
    const { back } = await connectGoogle(owner, "owner", "scope=company&apps=gmail");
    expect(back?.search).toBe("?connected=google");
    companyConnection = (await connectionsOf(owner)).data!.find((c) => c.scope === "company")!.id;
  });
});

describe("who sees and uses a connection", () => {
  it("a personal connection is seen by its owner and the Owner; a company one by every member; nobody outside", async () => {
    expect((await connectionsOf(alice)).data!.map((c) => c.id).sort()).toEqual([aliceConnection, companyConnection].sort());
    expect((await connectionsOf(bob)).data!.map((c) => c.id)).toEqual([companyConnection]);
    expect((await connectionsOf(owner)).data!.map((c) => c.id).sort()).toEqual([aliceConnection, companyConnection].sort());
    for (const user of [eve, pat]) expect((await user.client.from("integration_connections").select("id")).data ?? []).toEqual([]);
  });

  it("only its owner uses a personal connection; members use the company one; apps not granted are refused", async () => {
    expect(await runCapability(ctxOf(alice), aliceConnection, "gmail.search", { query: "devis" })).toMatchObject({ ok: true, data: [{ id: "m1", subject: "Devis", snippet: "Le devis est validé" }] });
    expect(await runCapability(ctxOf(bob), aliceConnection, "gmail.search", { query: "devis" })).toEqual({ ok: false, error: "not_found" });
    expect(await runCapability(ctxOf(owner, "owner"), aliceConnection, "gmail.search", { query: "devis" })).toEqual({ ok: false, error: "not_found" });
    expect(await runCapability(ctxOf(bob), companyConnection, "gmail.search", { query: "devis" })).toMatchObject({ ok: true });
    expect(await runCapability(ctxOf(alice), aliceConnection, "calendar.events", {})).toEqual({ ok: false, error: "not_granted" });
    expect(await runCapability(ctxOf(eve, "owner", eveCompany), companyConnection, "gmail.search", {})).toEqual({ ok: false, error: "not_found" });
  });

  it("logs write actions without their content", async () => {
    expect(await runCapability(ctxOf(bob), companyConnection, "gmail.send", { to: ["client@atlas.test"], subject: "Relance confidentielle", body: "Montant dû : 4 200 €" })).toMatchObject({ ok: true });
    const logs = await sql<{ action: string; metadata: unknown }>("select action, metadata from public.audit_log where company_id = $1 and target_type = 'integration' order by id", [company]);
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["integration.connected", "integration.used"]));
    expect(JSON.stringify(logs)).not.toMatch(/Relance confidentielle|4 200|client@atlas/);
  });

  it("a provider the company switches off can no longer be used", async () => {
    as(owner, "owner");
    expect(await setProviderEnabledAction({ provider: "google", enabled: false })).toEqual({ ok: true });
    expect(await runCapability(ctxOf(alice), aliceConnection, "gmail.search", {})).toEqual({ ok: false, error: "not_found" });
    as(alice);
    expect(await setProviderEnabledAction({ provider: "google", enabled: true })).toEqual({ ok: false, error: "forbidden" });
    as(owner, "owner");
    await setProviderEnabledAction({ provider: "google", enabled: true });
  });

  it("an access refused by the provider marks the connection to reconnect", async () => {
    await sql("update public.integration_tokens set expires_at = now() - interval '1 minute' where connection_id = $1", [companyConnection]);
    state.refreshFails = true;
    expect(await runCapability(ctxOf(bob), companyConnection, "gmail.search", {})).toEqual({ ok: false, error: "expired" });
    state.refreshFails = false;
    const [row] = await sql<{ status: string }>("select status from public.integration_connections where id = $1", [companyConnection]);
    expect(row.status).toBe("expired");
  });
});

describe("revocation", () => {
  it("a colleague cannot revoke someone else's connection; the Owner can, and then nothing can use it", async () => {
    as(bob);
    expect(await revokeConnectionAction({ connectionId: aliceConnection })).toEqual({ ok: false, error: "forbidden" });
    as(owner, "owner");
    expect(await revokeConnectionAction({ connectionId: aliceConnection })).toEqual({ ok: true });
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.integration_tokens where connection_id = $1", [aliceConnection]);
    expect(n).toBe(0);
    expect(await runCapability(ctxOf(alice), aliceConnection, "gmail.search", {})).toEqual({ ok: false, error: "not_found" });
    const [row] = await sql<{ status: string }>("select status from public.integration_connections where id = $1", [aliceConnection]);
    expect(row.status).toBe("revoked");
  });
});
