import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { ASSISTANTS, assistantFor, blinkDelay, ROBOT_FACE } from "@/modules/avatars/assistants";
import { avatarUrlFor, sniffPhotoType } from "@/modules/avatars/files";
import { AVATAR_BACKGROUND, AVATAR_PROMPT } from "@/modules/avatars/prompt";

/** Step 11: assistant characters, the standardized avatar prompt, and photo checks. */
describe("assistant characters", () => {
  it("exist for every provider and Auto, with a face drawn inside the 256 px robot", () => {
    for (const id of ["openai", "anthropic", "google", "auto"] as const) {
      expect(ASSISTANTS[id].image).toMatch(/^\/avatars\/assistants\/[a-z]+\.webp$/);
      expect(existsSync(`public${ASSISTANTS[id].image}`)).toBe(true);
    }
    for (const part of [...ROBOT_FACE.eyes, ROBOT_FACE.mouth]) {
      expect(part.x).toBeGreaterThan(0);
      expect(part.x + part.w).toBeLessThan(256);
      expect(part.y + part.h).toBeLessThan(256);
    }
    // The robot is open art: its licence ships with the images.
    expect(existsSync("public/avatars/assistants/LICENSE-fluent-emoji.txt")).toBe(true);
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
