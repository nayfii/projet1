import { describe, expect, it } from "vitest";
import { newPasswordSchema, openedByRecentEmailLink, RECENT_EMAIL_LINK_SECONDS } from "@/modules/identity/password";

describe("password rule", () => {
  it("asks for at least 10 characters with letters and digits", () => {
    expect(newPasswordSchema.safeParse("cendr2026!").success).toBe(true);
    expect(newPasswordSchema.safeParse("Été en 2026 à Lyon").success).toBe(true);
    expect(newPasswordSchema.safeParse("court1").success).toBe(false);
    expect(newPasswordSchema.safeParse("seulementdeslettres").success).toBe(false);
    expect(newPasswordSchema.safeParse("12345678901").success).toBe(false);
    expect(newPasswordSchema.safeParse(`a1${"x".repeat(200)}`).success).toBe(false);
  });
});

describe("a new password without the current one", () => {
  const now = 1_800_000_000;
  it("only right after an e-mail link (sign-in or forgot password)", () => {
    expect(openedByRecentEmailLink([{ method: "otp", timestamp: now - 60 }], now)).toBe(true);
    expect(openedByRecentEmailLink([{ method: "recovery", timestamp: now - 60 }], now)).toBe(true);
    expect(openedByRecentEmailLink([{ method: "otp", timestamp: now - RECENT_EMAIL_LINK_SECONDS - 1 }], now)).toBe(false);
    expect(openedByRecentEmailLink([{ method: "password", timestamp: now - 10 }], now)).toBe(false);
    expect(openedByRecentEmailLink(undefined, now)).toBe(false);
    expect(openedByRecentEmailLink([{ method: "otp" }], now)).toBe(false);
  });
});
