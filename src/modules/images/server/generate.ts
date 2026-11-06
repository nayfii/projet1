import "server-only";
import { deflateSync } from "node:zlib";
import { generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { aiProviderKey, chatImageModel, fakeProviderEnabled } from "@/lib/env";
import { normalizeProviderError } from "@/modules/providers/errors";
import type { ProviderError } from "@/modules/providers/types";

export type ChatImage = { bytes: Uint8Array; mediaType: "image/png" | "image/jpeg" | "image/webp"; model: string; test: boolean };

/**
 * One image for the chat, made by ChatGPT's image model at OpenAI: from a description, or by
 * changing the given images (a photo the person attached, or the conversation's last image).
 * The description sent is the one Hide masked (docs/SECURITY.md); the images go as they are.
 * In test mode (AI_FAKE_PROVIDER) no model is called: a fixed test picture is returned.
 */
export async function generateChatImage(input: { prompt: string; images: Uint8Array[] }): Promise<{ ok: true; image: ChatImage } | { ok: false; error: ProviderError }> {
  if (fakeProviderEnabled()) {
    return { ok: true, image: { bytes: testPicture(input.images.length > 0), mediaType: "image/png", model: "test", test: true } };
  }
  const apiKey = aiProviderKey("openai");
  if (!apiKey) return { ok: false, error: { code: "missing_key", retryable: false } };
  const model = chatImageModel();
  try {
    const { image } = await generateImage({
      model: createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" }).image(model),
      prompt: input.images.length ? { images: input.images, text: input.prompt } : input.prompt,
      size: "1024x1024",
      providerOptions: { openai: { quality: "medium", ...(input.images.length ? { inputFidelity: "high" } : {}) } },
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(180_000),
    });
    const mediaType = image.mediaType === "image/jpeg" || image.mediaType === "image/webp" ? image.mediaType : "image/png";
    return { ok: true, image: { bytes: image.uint8Array, mediaType, model, test: false } };
  } catch (error) {
    return { ok: false, error: normalizeProviderError(error) };
  }
}

/** Test mode: a 256×256 PNG made here (a soft gradient; warmer when it "changed" a given image). */
function testPicture(edited: boolean): Uint8Array {
  const size = 256;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 3;
      raw[i] = edited ? 230 : 90 + Math.round((x / size) * 120);
      raw[i + 1] = 80 + Math.round((y / size) * 100);
      raw[i + 2] = edited ? 90 : 200;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png);
}
