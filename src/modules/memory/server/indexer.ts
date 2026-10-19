import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { embeddingsConfig } from "@/lib/env";
import type { UserClient } from "@/lib/supabase/server";
import { toCatalogModel } from "@/modules/providers/catalog";
import { embeddingModelName, embeddingsAvailable, embedTexts, toVectorLiteral } from "@/modules/providers/server/embeddings";
import { computeCharge } from "@/modules/usage/credits";
import { recordUsage } from "@/modules/usage/server/record";
import { MAX_DOCUMENT_CHARS, type AttachmentExtension } from "@/modules/documents/file-types";
import { extractDocument } from "@/modules/documents/server/extract";
import { chunkText } from "../chunking";

/**
 * Builds the search index of memory entries and documents. Runs with the user's session, so RLS
 * guarantees that only memories the user may write are indexed. Embedding calls are logged as usage.
 */

async function chargeEmbedding(supabase: UserClient, ctx: MemberContext, tokens: number, status: "ok" | "error", errorCode: string | null, started: number) {
  const config = embeddingsConfig();
  const { data } = await supabase.from("ai_models").select("*").eq("provider", config.provider).eq("api_model_id", config.model).maybeSingle();
  const charge = data ? computeCharge(toCatalogModel(data).pricing, { inputTokens: tokens, outputTokens: 0, cachedInputTokens: 0 }) : { credits: 0, estimatedCostUsd: 0 };
  await recordUsage({
    companyId: ctx.active.companyId,
    userId: ctx.user.id,
    feature: "embedding",
    conversationId: null,
    messageId: null,
    provider: config.provider,
    modelId: data?.id ?? config.model,
    apiModelId: config.model,
    autoRouted: false,
    inputTokens: tokens,
    outputTokens: 0,
    cachedInputTokens: 0,
    tokensEstimated: false,
    credits: charge.credits,
    estimatedCostUsd: charge.estimatedCostUsd,
    status,
    errorCode,
    latencyMs: Date.now() - started,
  });
}

/** Embeds the query of a chat turn. Null when embeddings are unavailable (word search still works). */
export async function embedQuery(supabase: UserClient, ctx: MemberContext, text: string): Promise<string | null> {
  if (!embeddingsAvailable() || !text.trim()) return null;
  const started = Date.now();
  const result = await embedTexts([text.slice(0, 8000)]);
  await chargeEmbedding(supabase, ctx, result.ok ? result.tokens : 0, result.ok ? "ok" : "error", result.ok ? null : result.error.code, started);
  return result.ok ? toVectorLiteral(result.vectors[0]) : null;
}

/** (Re)indexes one entry after it was created or edited. Returns false if the index could not be built. */
export async function indexEntry(supabase: UserClient, ctx: MemberContext, entry: { id: string; title: string; content: string }): Promise<boolean> {
  if (!embeddingsAvailable()) return false;
  const started = Date.now();
  const result = await embedTexts([`${entry.title}\n${entry.content}`]);
  await chargeEmbedding(supabase, ctx, result.ok ? result.tokens : 0, result.ok ? "ok" : "error", result.ok ? null : result.error.code, started);
  if (!result.ok) return false;
  const { error } = await supabase
    .from("memory_entries")
    .update({ embedding: toVectorLiteral(result.vectors[0]), embedding_model: embeddingModelName() })
    .eq("id", entry.id);
  return !error;
}

/**
 * Reads a stored document, splits it into passages and indexes them. Documents without embeddings
 * (no key, provider error) stay searchable by exact words and are flagged.
 */
export async function processDocument(
  supabase: UserClient,
  ctx: MemberContext,
  document: { id: string; spaceId: string },
  bytes: Uint8Array,
  ext: AttachmentExtension,
): Promise<void> {
  const fail = (code: string) => supabase.from("documents").update({ status: "failed", error_code: code }).eq("id", document.id);
  try {
    const extracted = await extractDocument(bytes, ext, MAX_DOCUMENT_CHARS);
    if (!extracted.text) {
      await fail("no_text");
      return;
    }
    const chunks = chunkText(extracted.text, extracted.pages);

    let vectors: number[][] | null = null;
    let embedError: string | null = embeddingsAvailable() ? null : "missing_key";
    if (embeddingsAvailable()) {
      const started = Date.now();
      const result = await embedTexts(chunks.map((c) => c.content));
      await chargeEmbedding(supabase, ctx, result.ok ? result.tokens : 0, result.ok ? "ok" : "error", result.ok ? null : result.error.code, started);
      if (result.ok) vectors = result.vectors;
      else embedError = result.error.code;
    }

    const model = embeddingModelName();
    for (let i = 0; i < chunks.length; i += 100) {
      const rows = chunks.slice(i, i + 100).map((c, j) => ({
        document_id: document.id,
        space_id: document.spaceId,
        chunk_index: c.index,
        content: c.content,
        page: c.page,
        char_start: c.charStart,
        char_end: c.charEnd,
        embedding: vectors ? toVectorLiteral(vectors[i + j]) : null,
        embedding_model: vectors ? model : null,
      }));
      const { error } = await supabase.from("document_chunks").insert(rows);
      if (error) {
        await fail("processing_failed");
        return;
      }
    }
    await supabase
      .from("documents")
      .update({
        status: "ready",
        error_code: vectors ? null : `words_only:${embedError}`,
        extracted_text: extracted.text,
        text_truncated: extracted.truncated,
        page_count: extracted.pageCount,
        chunk_count: chunks.length,
      })
      .eq("id", document.id);
  } catch {
    await fail("processing_failed");
  }
}
