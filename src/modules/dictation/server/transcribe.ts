import "server-only";
import { transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { aiProviderKey, dictationModel, fakeProviderEnabled } from "@/lib/env";

export type Transcript = { text: string; seconds: number | null; model: string; test: boolean };

/**
 * Speech → text with OpenAI's transcription model (CLAUDE.md §11: "the same model as OpenAI").
 * The recording goes to OpenAI unmasked — Hide applies to the text afterwards, before any chat model
 * (docs/SECURITY.md, data flows). We keep neither the audio nor the text. In test mode no model is called.
 */
export async function transcribeSpeech(audio: Uint8Array, locale: "fr" | "en"): Promise<Transcript | "not_configured"> {
  if (fakeProviderEnabled()) {
    const text = locale === "fr" ? "Ceci est une dictée de démonstration (mode test)." : "This is a demo dictation (test mode).";
    return { text, seconds: null, model: "test", test: true };
  }
  const apiKey = aiProviderKey("openai");
  if (!apiKey) return "not_configured";
  const model = dictationModel();
  const result = await transcribe({
    model: createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" }).transcription(model),
    audio,
    providerOptions: { openai: { language: locale } },
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
  });
  return { text: result.text.trim(), seconds: result.durationInSeconds ?? null, model, test: false };
}
