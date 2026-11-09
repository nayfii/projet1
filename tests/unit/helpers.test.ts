import { describe, expect, it } from "vitest";
import { landingPath, safeNextPath } from "@/lib/safe-redirect";
import { initials } from "@/lib/utils";
import { toErrorCode } from "@/lib/errors";
import { describeEvent } from "@/modules/audit/describe";

const APP = "https://app.example.eu";

describe("safeNextPath (no open redirects after sign-in)", () => {
  it.each([
    ["/clients", "/clients"],
    ["/invite/abc?x=1", "/invite/abc?x=1"],
    [`${APP}/admin/members`, "/admin/members"],
    ["https://evil.example.com/phish", "/"],
    ["//evil.example.com", "/"],
    ["/\\evil.example.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/\t/evil.example.com", "/"],
    ["/%09/evil.example.com", "/%09/evil.example.com"],
    [`${APP}//evil.example.com`, "/"],
    ["/ok\n/evil", "/"],
    [null, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input, APP)).toBe(expected);
    // Wherever it is used, the result stays on our site.
    expect(new URL(safeNextPath(input, APP), APP).origin).toBe(APP);
  });
});

it("follows an email link through /auth/callback, on our site only", () => {
  // Our templates encode the destination ({{ .RedirectTo }}), so it arrives as one `next` value.
  const link = new URL(`${APP}/auth/confirm?token_hash=t&type=magiclink&next=${encodeURIComponent(`${APP}/auth/callback?via=email&next=%2Fadmin`)}`);
  expect(safeNextPath(link.searchParams.get("next"), APP)).toBe("/auth/callback?via=email&next=%2Fadmin");
});

describe("landingPath (where a sign-in lands)", () => {
  it("opens our console for our team when no precise page was asked for", () => {
    expect(landingPath("/", true)).toBe("/platform");
  });
  it("keeps the asked page, and the company space for everyone else", () => {
    expect(landingPath("/invite/abc", true)).toBe("/invite/abc");
    expect(landingPath("/chat", true)).toBe("/chat");
    expect(landingPath("/", false)).toBe("/");
  });
});

describe("initials", () => {
  it.each([
    ["Nathalie Dupont", "ND"],
    ["olivier@acme.fr", "O"],
    ["jean-luc.picard@x.fr", "JP"],
    ["", "?"],
    [null, "?"],
  ])("%s → %s", (input, expected) => {
    expect(initials(input)).toBe(expected);
  });
});

describe("toErrorCode", () => {
  it("keeps codes raised by the database", () => {
    expect(toErrorCode({ message: "seat_limit_reached" })).toBe("seat_limit_reached");
  });
  it("maps RLS refusals to forbidden", () => {
    expect(toErrorCode({ message: 'new row violates row-level security policy for table "clients"', code: "42501" })).toBe("forbidden");
  });
  it("never leaks unknown database messages", () => {
    expect(toErrorCode({ message: "relation secret does not exist" })).toBe("unknown");
  });
});

describe("activity descriptions", () => {
  it("resolves names only from what the viewer can already see", () => {
    const event = { action: "client.assigned", target_id: "c1", metadata: { user_id: "u1" } };
    expect(describeEvent(event, { people: new Map([["u1", "Olivier"]]), clientNames: new Map([["c1", "Client A"]]) }).values).toMatchObject({
      client: "Client A",
      person: "Olivier",
    });
    expect(describeEvent(event, {}).values).toMatchObject({ client: "—", person: "—" });
  });
  it("falls back for unknown actions", () => {
    expect(describeEvent({ action: "future.thing", target_id: null, metadata: {} }, {}).key).toBe("other");
  });
});
