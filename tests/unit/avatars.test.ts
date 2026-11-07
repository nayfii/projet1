import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { avatarUrlFor, sniffPhotoType } from "@/modules/avatars/files";
import { AVATAR_BACKGROUND, AVATAR_PROMPT } from "@/modules/avatars/prompt";

/** Step 11: assistant characters, the standardized avatar prompt, and photo checks. */
describe("models' marks", () => {
  it("are the providers' own logos, one per provider (no robot images left)", async () => {
    const source = readFileSync("src/modules/providers/ui/provider-logo.tsx", "utf8");
    expect(source).toContain("LobeHub Icons");
    for (const provider of ["openai", "anthropic"]) expect(source).toContain(`provider === "${provider}"`);
    expect(existsSync("public/avatars/assistants")).toBe(false);
  });
});

describe("the avatar prompt", () => {
  it("is one standardized recipe: likeness, style, framing, light, background", () => {
    expect(AVATAR_PROMPT).toContain("recognizable");
    expect(AVATAR_PROMPT).toContain("Do not change their apparent age, gender or ethnicity");
    expect(AVATAR_PROMPT).toContain("3D emoji-style head");
    expect(AVATAR_PROMPT).toContain("the head only");
    expect(AVATAR_PROMPT).toContain("rim light");
    expect(AVATAR_PROMPT).toContain(AVATAR_BACKGROUND);
    expect(AVATAR_PROMPT).toContain("no text, no watermark");
  });
});

describe("photos", () => {
  it("are recognised by their bytes, not their name", () => {
    expect(sniffPhotoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffPhotoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffPhotoType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffPhotoType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffPhotoType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("give avatar URLs the database accepts", () => {
    const url = avatarUrlFor("84f89933-a458-4f5e-bae7-deb843dad86b", "4a7104ad-237e-422d-a699-ecd7a76dc9b8");
    expect(url).toMatch(/^\/api\/avatars\/[0-9a-f-]{36}\?v=[0-9a-f-]{36}$/);
  });
});
