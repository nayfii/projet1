import "server-only";
import { transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { aiProviderKey, dictationModel, fakeProviderEnabled } from "@/lib/env";
import { transcriptionPrompt } from "../cleanup";

export type Transcript = { text: string; seconds: number | null; model: string; test: boolean };

/**
 * Speech → text with OpenAI's transcription model (CLAUDE.md §11: "the same model as OpenAI").
 * The recording goes to OpenAI unmasked — Hide applies to the text afterwards, before any chat model
 * (docs/SECURITY.md, data flows). We keep neither the audio nor the text. In test mode no model is called.
 * The hint given with it holds our product's words and the end of what was already said in this same
 * recording (`previous`), so a long dictation cut in parts reads as one.
 */
export async function transcribeSpeech(audio: Uint8Array, locale: "fr" | "en", previous: string | null = null): Promise<Transcript | "not_configured"> {
  if (fakeProviderEnabled()) {
    // With a hesitation, so the cleanup that follows (and "Show the original") can be seen in test mode.
    const text = locale === "fr" ? "Euh, ceci est une dictée de démonstration (mode test)." : "Um, this is a demo dictation (test mode).";
    return { text, seconds: null, model: "test", test: true };
  }
  const apiKey = aiProviderKey("openai");
  if (!apiKey) return "not_configured";
  const model = dictationModel();
  const result = await transcribe({
    model: createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" }).transcription(model),
    audio,
    providerOptions: { openai: { language: locale, prompt: transcriptionPrompt(locale, previous), temperature: 0 } },
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
  });
  return { text: result.text.trim(), seconds: result.durationInSeconds ?? null, model, test: false };
}
