import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS, scopesFor } from "@/modules/integrations/providers";
import { authorizeUrl, codeChallenge, exchangeCode, refreshTokens } from "@/modules/integrations/server/oauth";
import { caller, EXECUTORS, ProviderCallError, rawEmail } from "@/modules/integrations/server/executors";
import { openToken, sealToken } from "@/modules/integrations/server/crypto";

const client = { clientId: "client-123", clientSecret: "secret-456" };
type Captured = { url: string; init: RequestInit };

/** Replaces fetch with canned answers, keeping each request for inspection. */
function mockFetch(answers: (url: string, init: RequestInit) => unknown) {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const body = answers(String(url), init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OAuth: least privilege, PKCE, no secret in the browser", () => {
  it("asks only for the chosen apps' permissions", () => {
    const calendar = scopesFor(PROVIDERS.google, ["calendar"]);
    expect(calendar).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(calendar.join(" ")).not.toMatch(/gmail|drive/);
    expect(scopesFor(PROVIDERS.microsoft, ["onedrive"])).toEqual(["openid", "email", "profile", "offline_access", "User.Read", "Files.Read.All"]);
  });

  it("builds each provider's authorize address its own way, with PKCE where supported", () => {
    const google = new URL(authorizeUrl(PROVIDERS.google, client, { redirectUri: "https://app.test/cb", state: "s".repeat(43), scopes: scopesFor(PROVIDERS.google, ["gmail"]), codeVerifier: "v".repeat(64) }));
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(google.searchParams.get("access_type")).toBe("offline");
    expect(google.searchParams.get("scope")).toContain("gmail.readonly");
    expect(google.toString()).not.toContain(client.clientSecret);

    const slack = new URL(authorizeUrl(PROVIDERS.slack, client, { redirectUri: "https://app.test/cb", state: "s".repeat(43), scopes: scopesFor(PROVIDERS.slack, ["slack"]), codeVerifier: "v".repeat(64) }));
    expect(slack.searchParams.get("scope")).toBe("channels:read,channels:history,chat:write");
    expect(slack.searchParams.get("code_challenge")).toBeNull();

    const notion = new URL(authorizeUrl(PROVIDERS.notion, client, { redirectUri: "https://app.test/cb", state: "s".repeat(43), scopes: [], codeVerifier: "v".repeat(64) }));
    expect(notion.searchParams.get("owner")).toBe("user");
    expect(notion.searchParams.has("scope")).toBe(false);

    const canva = new URL(authorizeUrl(PROVIDERS.canva, client, { redirectUri: "https://app.test/cb", state: "s".repeat(43), scopes: scopesFor(PROVIDERS.canva, ["canva"]), codeVerifier: "v".repeat(64) }));
    expect(canva.searchParams.get("code_challenge")).toBe(codeChallenge("v".repeat(64)));
  });

  it("computes the PKCE challenge as RFC 7636 says", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("exchanges the code on our server: form body (Google), Basic auth and JSON (Notion), Slack's ok:false refused", async () => {
    const calls = mockFetch((url) =>
      url.includes("oauth2.googleapis.com/token")
        ? { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "openid https://www.googleapis.com/auth/calendar.events" }
        : url.includes("userinfo")
          ? { sub: "123", email: "claire@lumen.test" }
          : url.includes("api.notion.com/v1/oauth/token")
            ? { access_token: "nt", workspace_name: "Lumen", workspace_id: "w1" }
            : { ok: false, error: "invalid_code" },
    );
    const g = await exchangeCode(PROVIDERS.google, client, { code: "c", redirectUri: "https://app.test/cb", codeVerifier: "v".repeat(64), scopes: [] });
    expect(g).toMatchObject({ accessToken: "at", refreshToken: "rt", account: { id: "123", label: "claire@lumen.test" } });
    const googleBody = new URLSearchParams(String(calls[0].init.body));
    expect(googleBody.get("code_verifier")).toBe("v".repeat(64));
    expect(googleBody.get("client_secret")).toBe(client.clientSecret);

    const n = await exchangeCode(PROVIDERS.notion, client, { code: "c", redirectUri: "https://app.test/cb", codeVerifier: "x", scopes: [] });
    expect(n.account).toEqual({ id: "w1", label: "Lumen" });
    const notionCall = calls.find((c) => c.url.includes("notion"))!;
    expect((notionCall.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("client-123:secret-456").toString("base64")}`);
    expect(JSON.parse(String(notionCall.init.body))).toEqual({ grant_type: "authorization_code", code: "c", redirect_uri: "https://app.test/cb" });

    await expect(exchangeCode(PROVIDERS.slack, client, { code: "c", redirectUri: "https://app.test/cb", codeVerifier: "x", scopes: [] })).rejects.toMatchObject({ code: "exchange_failed" });
  });

  it("keeps the refresh token unless the provider rotates it (Canva, Notion: single use)", async () => {
    mockFetch(() => ({ access_token: "new", expires_in: 3600 }));
    expect((await refreshTokens(PROVIDERS.google, client, "old-rt", [])).refreshToken).toBe("old-rt");
    mockFetch(() => ({ access_token: "new", refresh_token: "rotated", expires_in: 14400 }));
    expect((await refreshTokens(PROVIDERS.canva, client, "old-rt", [])).refreshToken).toBe("rotated");
  });
});

describe("tokens are sealed", () => {
  it("round-trips, refuses a tampered token, and needs the key", () => {
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", "k".repeat(40));
    const sealed = sealToken("ya29.secret-token");
    expect(sealed).not.toContain("secret-token");
    expect(openToken(sealed)).toBe("ya29.secret-token");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openToken(parts.join("."))).toThrow();
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", "");
    expect(() => sealToken("x")).toThrow(/INTEGRATIONS_ENCRYPTION_KEY/);
  });
});

describe("actions against the official APIs", () => {
  it("Gmail: sends an RFC 2822 message, base64url-encoded, to the send endpoint", async () => {
    const calls = mockFetch(() => ({ id: "m1" }));
    const call = caller(EXECUTORS.google.base, "at");
    expect(await EXECUTORS.google.run["gmail.send"](call, { to: ["a@client.test"], subject: "Relance facture", body: "Bonjour" })).toEqual({ id: "m1" });
    expect(calls[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const raw = JSON.parse(String(calls[0].init.body)).raw as string;
    expect(Buffer.from(raw, "base64url").toString()).toContain("To: a@client.test\r\nSubject: Relance facture");
    expect(Buffer.from(rawEmail({ to: ["a@b.test"], subject: "Réunion", body: "x" }), "base64url").toString()).toContain("Subject: =?UTF-8?B?");
  });

  it("Outlook: sendMail with the Graph message shape", async () => {
    const calls = mockFetch(() => new Response(null, { status: 202 }));
    await EXECUTORS.microsoft.run["outlook.send"](caller(EXECUTORS.microsoft.base, "at"), { to: ["a@client.test"], subject: "Devis", body: "Ci-joint" });
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      message: { subject: "Devis", body: { contentType: "Text", content: "Ci-joint" }, toRecipients: [{ emailAddress: { address: "a@client.test" } }] },
      saveToSentItems: true,
    });
  });

  it("Slack: ok:false becomes a clear code (not in channel = forbidden)", async () => {
    mockFetch(() => ({ ok: false, error: "not_in_channel" }));
    await expect(EXECUTORS.slack.run["slack.post"](caller(EXECUTORS.slack.base, "xoxb"), { channel: "C1", text: "Bonjour" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("Drive: escapes the search text; a 401 becomes 'unauthorized' (the token is refreshed or the connection expires)", async () => {
    const calls = mockFetch((url) => (url.includes("files?") ? { files: [{ id: "f1", name: "Offre", mimeType: "application/vnd.google-apps.document" }] } : {}));
    await EXECUTORS.google.run["drive.search"](caller(EXECUTORS.google.base, "at"), { query: "offre d'Atlas" });
    expect(decodeURIComponent(calls[0].url)).toContain("fullText contains 'offre d\\'Atlas'");
    mockFetch(() => new Response("{}", { status: 401 }));
    await expect(EXECUTORS.google.run["calendar.events"](caller(EXECUTORS.google.base, "at"), {})).rejects.toBeInstanceOf(ProviderCallError);
  });

  it("refuses malformed input before calling anything", async () => {
    const calls = mockFetch(() => ({}));
    await expect(EXECUTORS.google.run["gmail.send"](caller(EXECUTORS.google.base, "at"), { to: ["not an email"], subject: "x", body: "y" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("Notion: reads a page's blocks as text, with the API version header", async () => {
    const calls = mockFetch((url) =>
      url.includes("/pages/")
        ? { properties: { Name: { type: "title", title: [{ plain_text: "Process qualité" }] } } }
        : { results: [{ type: "heading_2", heading_2: { rich_text: [{ plain_text: "Relecture" }] } }, { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Deux personnes relisent." }] } }], has_more: false, next_cursor: null },
    );
    const page = await EXECUTORS.notion.run["notion.read"](caller(EXECUTORS.notion.base, "nt", EXECUTORS.notion.headers), { id: "p1" });
    expect(page).toEqual({ name: "Process qualité", text: "## Relecture\nDeux personnes relisent." });
    expect((calls[0].init.headers as Record<string, string>)["Notion-Version"]).toBe("2022-06-28");
  });
});
