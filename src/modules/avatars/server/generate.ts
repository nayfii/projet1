import "server-only";
import { generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { aiProviderKey, avatarImageModel, fakeProviderEnabled } from "@/lib/env";
import { AVATAR_PROMPT } from "../prompt";

export type GeneratedAvatar = { bytes: Uint8Array; mediaType: "image/webp" | "image/png" | "image/jpeg"; model: string; test: boolean };

/**
 * Photo → 3D avatar with the standardized prompt (prompt.ts). The photo goes to OpenAI's image
 * model only (docs/SECURITY.md, data flows) and is not kept by us. In test mode no model is called:
 * the result is a fixed test character, fetched from this app's own public files.
 */
export async function generateAvatar(photo: Uint8Array, origin: string): Promise<GeneratedAvatar | "not_configured"> {
  if (fakeProviderEnabled()) {
    const res = await fetch(new URL("/avatars/test-person.png", origin));
    if (!res.ok) throw new Error("test_avatar_missing");
    return { bytes: new Uint8Array(await res.arrayBuffer()), mediaType: "image/png", model: "test", test: true };
  }
  const apiKey = aiProviderKey("openai");
  if (!apiKey) return "not_configured";
  const model = avatarImageModel();
  const { image } = await generateImage({
    model: createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" }).image(model),
    prompt: { images: [photo], text: AVATAR_PROMPT },
    size: "1024x1024",
    // A transparent PNG: a cut-out set on the app's own glass (black or white with the interface).
    providerOptions: { openai: { inputFidelity: "high", quality: "medium", background: "transparent", outputFormat: "png" } },
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(120_000),
  });
  const mediaType = image.mediaType === "image/png" || image.mediaType === "image/jpeg" ? image.mediaType : "image/webp";
  return { bytes: image.uint8Array, mediaType, model, test: false };
}
