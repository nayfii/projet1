import { describe, expect, it } from "vitest";
import { totpCode } from "../helpers/totp";

/** The tests' authenticator gives the codes of RFC 6238's reference vectors (SHA-1, last 6 digits). */
describe("test authenticator", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
  ])("at %i s gives %s", (seconds, code) => {
    expect(totpCode(secret, seconds * 1000)).toBe(code);
  });
});
