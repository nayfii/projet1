import { describe, expect, it } from "vitest";
import { safeNextPath, trailingNextParam } from "@/lib/safe-redirect";
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
    [null, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input, APP)).toBe(expected);
  });
});

describe("trailingNextParam (destination at the end of our email links)", () => {
  it.each([
    ["?token_hash=t&type=magiclink&next=http://localhost:3000/auth/callback?via=email&next=%2Finvite%2Fabc", "http://localhost:3000/auth/callback?via=email&next=%2Finvite%2Fabc"],
    ["?token_hash=t&type=invite&next=http://localhost:3000/invite/abc", "http://localhost:3000/invite/abc"],
    ["?next=%2Fclients", "/clients"],
    ["?token_hash=t&type=magiclink", null],
    ["?token_hash=t&notnext=x", null],
    ["?token_hash=t&next=", null],
  ])("%s → %s", (input, expected) => {
    expect(trailingNextParam(input)).toBe(expected);
  });

  it("keeps the inner destination through /auth/callback, on our site only", () => {
    const next = safeNextPath(trailingNextParam(`?token_hash=t&type=magiclink&next=${APP}/auth/callback?via=email&next=%2Fadmin`), APP);
    expect(next).toBe("/auth/callback?via=email&next=%2Fadmin");
    expect(safeNextPath(trailingNextParam("?type=magiclink&next=https://evil.example.com/auth/callback?next=/"), APP)).toBe("/");
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
