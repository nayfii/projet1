import "server-only";
import { transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { aiProviderKey, dictationModel, fakeDictationLatencyMs, fakeProviderEnabled } from "@/lib/env";
import { stripPromptEcho } from "../cleanup";

export type Transcript = { text: string; seconds: number | null; model: string; test: boolean };

/**
 * Speech → text with OpenAI's transcription model (CLAUDE.md §11: "the same model as OpenAI").
 * The recording goes to OpenAI unmasked — Hide applies to the text afterwards, before any chat model
 * (docs/SECURITY.md, data flows). We keep neither the audio nor the text. In test mode no model is called.
 * No hint and no language are given: the model detects the language spoken (people may dictate in
 * French with an English interface), and a hint was copied into the text by the real model.
 */
export async function transcribeSpeech(audio: Uint8Array, locale: "fr" | "en"): Promise<Transcript | "not_configured"> {
  if (fakeProviderEnabled()) {
    const wait = fakeDictationLatencyMs();
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
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
    providerOptions: { openai: { temperature: 0 } },
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
  });
  return { text: stripPromptEcho(result.text), seconds: result.durationInSeconds ?? null, model, test: false };
}
