import { describe, expect, it } from "vitest";
import { ASSISTANTS, assistantFor, blinkDelay } from "@/modules/avatars/assistants";
import { avatarUrlFor, sniffPhotoType } from "@/modules/avatars/files";
import { AVATAR_BACKGROUND, AVATAR_PROMPT } from "@/modules/avatars/prompt";

/** Step 11: assistant characters, the standardized avatar prompt, and photo checks. */
describe("assistant characters", () => {
  it("exist for every provider and Auto, with a face box inside the image", () => {
    for (const id of ["openai", "anthropic", "google", "auto"] as const) {
      const p = ASSISTANTS[id];
      expect(p.image).toMatch(/^\/avatars\/assistants\/[a-z]+\.webp$/);
      expect(p.face.x).toBeGreaterThan(0);
      expect(p.face.x + p.face.w).toBeLessThan(1);
      expect(p.face.y + p.face.h).toBeLessThan(1);
    }
    expect(assistantFor(null).id).toBe("auto");
    expect(assistantFor("anthropic").id).toBe("anthropic");
  });

  it("blink at stable, different moments", () => {
    expect(blinkDelay("a")).toBe(blinkDelay("a"));
    expect(blinkDelay("message-1")).toBeGreaterThanOrEqual(0);
    expect(blinkDelay("message-1")).toBeLessThan(4);
  });
});

describe("the avatar prompt", () => {
  it("is one standardized recipe: likeness, style, framing, light, background", () => {
    expect(AVATAR_PROMPT).toContain("recognizable");
    expect(AVATAR_PROMPT).toContain("Do not change their apparent age, gender or ethnicity");
    expect(AVATAR_PROMPT).toContain("head and the top of the shoulders");
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
