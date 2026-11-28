import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dictation understands every language OpenAI's transcription model understands (founder's request,
 * 2026-11-28): nothing forces a language, and no hint goes with the audio (the real model copied it).
 */
const calls = vi.hoisted(() => [] as { providerOptions?: { openai?: Record<string, unknown> } }[]);
vi.mock("ai", () => ({
  transcribe: async (options: { providerOptions?: { openai?: Record<string, unknown> } }) => {
    calls.push(options);
    return { text: " Context: ### Vocabulary: Cendr, Hide, Studio. ### Hola, ¿qué tal? ", durationInSeconds: 2 };
  },
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => ({ transcription: (model: string) => ({ model }) }) }));

const { transcribeSpeech } = await import("@/modules/dictation/server/transcribe");

describe("dictation languages", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("AI_FAKE_PROVIDER", "false");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  it("sends the audio alone: no language forced, no hint", async () => {
    for (const locale of ["fr", "en"] as const) await transcribeSpeech(new Uint8Array([1, 2, 3]), locale);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.providerOptions?.openai).not.toHaveProperty("language");
      expect(call.providerOptions?.openai).not.toHaveProperty("prompt");
    }
  });

  it("returns the speech in the language spoken, without anything the model copied from instructions", async () => {
    const result = await transcribeSpeech(new Uint8Array([1, 2, 3]), "fr");
    expect(result).toMatchObject({ text: "Hola, ¿qué tal?", seconds: 2, test: false });
  });
});
