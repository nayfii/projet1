import "server-only";
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogle } from "@ai-sdk/google";
import { aiProviderKey, embeddingsConfig, fakeProviderEnabled } from "@/lib/env";
import { normalizeProviderError } from "../errors";
import type { ProviderError, ProviderId } from "../types";
import { fakeEmbedding } from "../fake-embedding";

/**
 * Embeddings for the memory search index. The text sent here is memory content (entries and document
 * passages) and the user's question: this data flow is listed in docs/SECURITY.md.
 * The index is derived data: it can be rebuilt with another provider (the model is stored on each row).
 */
export type EmbeddingResult =
  | { ok: true; vectors: number[][]; tokens: number; provider: ProviderId; model: string }
  | { ok: false; error: ProviderError };

const BATCH = 96;

export function embeddingModelName(): string {
  return fakeProviderEnabled() ? "fake-embedding" : embeddingsConfig().model;
}

export function embeddingsAvailable(): boolean {
  return fakeProviderEnabled() || Boolean(aiProviderKey(embeddingsConfig().provider));
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  const config = embeddingsConfig();
  if (texts.length === 0) return { ok: true, vectors: [], tokens: 0, provider: config.provider, model: embeddingModelName() };
  if (fakeProviderEnabled()) {
    return {
      ok: true,
      vectors: texts.map((t) => fakeEmbedding(t, config.dimensions)),
      tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
      provider: config.provider,
      model: "fake-embedding",
    };
  }
  const apiKey = aiProviderKey(config.provider);
  if (!apiKey) return { ok: false, error: { code: "missing_key", retryable: false } };

  try {
    const vectors: number[][] = [];
    let tokens = 0;
    for (let i = 0; i < texts.length; i += BATCH) {
      const values = texts.slice(i, i + BATCH);
      const result =
        config.provider === "google"
          ? await embedMany({
              model: createGoogle({ apiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta" }).embedding(config.model),
              values,
              maxRetries: 1,
              providerOptions: { google: { outputDimensionality: config.dimensions } },
            })
          : await embedMany({
              model: createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" }).embedding(config.model),
              values,
              maxRetries: 1,
              providerOptions: { openai: { dimensions: config.dimensions } },
            });
      vectors.push(...result.embeddings);
      tokens += result.usage?.tokens ?? 0;
    }
    return { ok: true, vectors, tokens, provider: config.provider, model: config.model };
  } catch (error) {
    return { ok: false, error: normalizeProviderError(error) };
  }
}

/** pgvector literal: "[0.1,0.2,…]". */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(7) : "0")).join(",")}]`;
}
