"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient, type UserClient } from "@/lib/supabase/server";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { createEphemeralMasker, loadDetectionLists } from "@/modules/hide/server/masker";
import { runMemoryTask, type MemoryTaskError } from "@/modules/memory/server/ai-tasks";
import { indexEntry } from "@/modules/memory/server/indexer";
import { ANALYSIS_SYSTEM, analysisPrompt, normalizeForDuplicate, readProposals } from "../analysis";
import { PERSONAL } from "../destinations";
import { checkProposal, filterImportedText } from "../privacy";
import { IMPORT_LIMITS, IMPORT_SOURCES } from "../types";

/**
 * Knowledge import, on our server (CLAUDE.md §12). Everything runs with the person's own session: the
 * import and its proposals are theirs alone (RLS), and saving into a shared memory goes through that
 * memory's write rights like any entry. Nothing here logs the imported text.
 */

const hash = (text: string) => createHash("sha256").update(normalizeForDuplicate(text)).digest("hex");

const startSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  fileName: z.string().trim().min(1).max(255),
  fingerprint: z.string().min(8).max(128),
  found: z.number().int().min(0).max(1_000_000),
  selected: z.number().int().min(0).max(IMPORT_LIMITS.analysed),
});

/** Starts an import, or resumes the unfinished one of the same export (what was analysed is skipped). */
export async function startImportAction(input: z.input<typeof startSchema>): Promise<ActionResult<{ importId: string; processed: string[]; resumed: boolean }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("knowledge_imports")
    .select("id, processed_refs")
    .eq("company_id", ctx.active.companyId)
    .eq("fingerprint", parsed.data.fingerprint)
    .eq("status", "analyzing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, data: { importId: existing.id, processed: existing.processed_refs, resumed: true } };
  const { data, error } = await supabase
    .from("knowledge_imports")
    .insert({
      company_id: ctx.active.companyId,
      source: parsed.data.source,
      file_name: parsed.data.fileName,
      fingerprint: parsed.data.fingerprint,
      found: parsed.data.found,
      selected: parsed.data.selected,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: toErrorCode(error) };
  return { ok: true, data: { importId: data.id, processed: [], resumed: false } };
}

const itemSchema = z.object({
  ref: z.string().min(4).max(64),
  kind: z.enum(["conversation", "project", "document"]),
  title: z.string().max(300),
  date: z.string().max(40).nullable(),
  text: z.string().max(IMPORT_LIMITS.itemChars + 100),
});
const batchSchema = z.object({ importId: z.uuid(), items: z.array(itemSchema).min(1).max(IMPORT_LIMITS.batch) });

export type BatchOutcome = { proposed: number; excluded: number; duplicates: number };

/**
 * One batch of items: privacy filter (local), masking (Hide), one analysis by the company's model,
 * a second privacy check on each proposal, duplicates set aside, proposals stored for review.
 */
export async function analyzeImportBatchAction(input: z.input<typeof batchSchema>): Promise<ActionResult<BatchOutcome> | { ok: false; error: MemoryTaskError }> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: run } = await supabase
    .from("knowledge_imports")
    .select("id, company_id, source, status, analyzed, excluded_private, duplicates, proposed, failed, processed_refs")
    .eq("id", parsed.data.importId)
    .maybeSingle();
  if (!run || run.status !== "analyzing") return { ok: false, error: "not_found" };

  const done = new Set(run.processed_refs);
  const fresh = parsed.data.items.filter((i) => !done.has(i.ref));
  let excluded = 0;
  const kept: (z.infer<typeof itemSchema> & { clean: string })[] = [];
  for (const item of fresh) {
    const result = filterImportedText(item.title, item.text);
    if (!result.kept) excluded++;
    else if (result.text.trim().length >= IMPORT_LIMITS.minChars) kept.push({ ...item, clean: result.text });
  }

  let proposals: ReturnType<typeof readProposals> = [];
  let restore = (text: string) => text;
  if (kept.length > 0) {
    // Identifiers are replaced by placeholders before the model sees anything (amounts stay: they are the knowledge).
    const masker = createEphemeralMasker(await loadDetectionLists(supabase, ctx));
    const masked = await masker.mask(
      kept.flatMap((k) => [k.title, k.clean]).map((text) => ({ text, spans: masker.detect(text).filter((s) => s.category !== "amount") })),
    );
    const prompt = analysisPrompt(
      run.source as (typeof IMPORT_SOURCES)[number],
      kept.map((k, i) => ({ kind: k.kind, title: masked[i * 2].masked, date: k.date, text: masked[i * 2 + 1].masked })),
    );
    const answer = await runMemoryTask(supabase, ctx, { system: ANALYSIS_SYSTEM, user: prompt });
    if (!answer.ok) {
      await supabase.from("knowledge_imports").update({ failed: run.failed + fresh.length }).eq("id", run.id);
      return { ok: false, error: answer.error };
    }
    proposals = readProposals(answer.text, kept.length);
    restore = (text) => masker.restore(text);
  }

  // Second check, after restoring the real values for the person's review.
  const candidates: { title: string; content: string; category: string; level: string; target: string | null; sensitive: boolean; hash: string; date: string | null }[] = [];
  for (const p of proposals) {
    const title = restore(p.title);
    const content = restore(p.content);
    const check = checkProposal(title, content);
    if (check === "drop") {
      excluded++;
      continue;
    }
    const source = kept[p.from - 1];
    candidates.push({
      title,
      content,
      category: p.category,
      level: p.level,
      target: p.target ? restore(p.target) : null,
      sensitive: check === "doubtful",
      hash: hash(`${title} ${content}`),
      date: source?.date && !Number.isNaN(Date.parse(source.date)) ? source.date : null,
    });
  }

  const unique = await withoutDuplicates(supabase, ctx.user.id, ctx.active.companyId, candidates);
  const duplicates = candidates.length - unique.length;
  if (unique.length > 0) {
    const { error } = await supabase.from("knowledge_import_items").insert(
      unique.map((c) => ({
        import_id: run.id,
        company_id: run.company_id,
        category: c.category,
        level: c.level,
        target_hint: c.target,
        title: c.title,
        content: c.content,
        sensitive: c.sensitive,
        content_hash: c.hash,
        source_date: c.date,
      })),
    );
    if (error) return { ok: false, error: toErrorCode(error) };
  }
  const processed = [...run.processed_refs, ...fresh.map((i) => i.ref)].slice(-2000);
  await supabase
    .from("knowledge_imports")
    .update({
      analyzed: run.analyzed + fresh.length,
      excluded_private: run.excluded_private + excluded,
      duplicates: run.duplicates + duplicates,
      proposed: run.proposed + unique.length,
      processed_refs: processed,
    })
    .eq("id", run.id);
  return { ok: true, data: { proposed: unique.length, excluded, duplicates } };
}

/** Already proposed in an import, already in a memory this person reads, or already a personal note. */
async function withoutDuplicates<T extends { hash: string; content: string }>(supabase: UserClient, userId: string, companyId: string, candidates: T[]): Promise<T[]> {
  if (candidates.length === 0) return [];
  const [{ data: known }, inMemory, { data: notes }] = await Promise.all([
    supabase.from("knowledge_import_items").select("content_hash").eq("user_id", userId).in("content_hash", candidates.map((c) => c.hash)),
    // The same sentence already in a memory this person reads (one small request per proposal).
    Promise.all(
      candidates.map(async (c) =>
        c.content.length > 1000
          ? null
          : (await supabase.from("memory_entries").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "active").eq("content", c.content)).count
            ? normalizeForDuplicate(c.content)
            : null,
      ),
    ),
    supabase.from("personal_memory").select("content").eq("company_id", companyId).eq("user_id", userId),
  ]);
  const seen = new Set([
    ...(known ?? []).map((k) => k.content_hash),
    ...inMemory.filter((n): n is string => Boolean(n)),
    ...(notes ?? []).map((e) => normalizeForDuplicate(e.content)),
  ]);
  const out: T[] = [];
  for (const c of candidates) {
    const norm = normalizeForDuplicate(c.content);
    if (seen.has(c.hash) || seen.has(norm) || [...(notes ?? [])].some((n) => normalizeForDuplicate(n.content).includes(norm))) continue;
    seen.add(c.hash);
    seen.add(norm);
    out.push(c);
  }
  return out;
}

/** The analysis is over: the proposals wait for the person's review (or there is nothing to review). */
export async function finishAnalysisAction(input: { importId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(input.importId);
  if (!id.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { count } = await supabase.from("knowledge_import_items").select("id", { count: "exact", head: true }).eq("import_id", id.data).eq("status", "pending");
  const { error } = await supabase
    .from("knowledge_imports")
    .update(count ? { status: "review" } : { status: "done", finished_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("status", "analyzing");
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/memory/import");
  return { ok: true };
}

const decisionSchema = z.object({
  importId: z.uuid(),
  decisions: z
    .array(
      z.object({
        itemId: z.uuid(),
        accept: z.boolean(),
        destination: z.union([z.literal(PERSONAL), z.uuid()]),
        title: z.string().trim().min(1).max(200),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * The person's review: accepted proposals are saved where they chose (their own memory, or a memory
 * they may write in: the database checks), refused ones are deleted at once.
 */
export async function applyImportAction(input: z.input<typeof decisionSchema>): Promise<ActionResult<{ saved: number; failed: number }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: run } = await supabase.from("knowledge_imports").select("id, source, saved, status").eq("id", parsed.data.importId).maybeSingle();
  if (!run || run.status === "analyzing") return { ok: false, error: "not_found" };
  const { data: pending } = await supabase
    .from("knowledge_import_items")
    .select("id")
    .eq("import_id", run.id)
    .eq("status", "pending")
    .in("id", parsed.data.decisions.map((d) => d.itemId));
  const allowed = new Set((pending ?? []).map((p) => p.id));

  let saved = 0;
  let failed = 0;
  const refused: string[] = [];
  for (const d of parsed.data.decisions) {
    if (!allowed.has(d.itemId)) continue;
    if (!d.accept) {
      refused.push(d.itemId);
      continue;
    }
    if (d.destination === PERSONAL) {
      const note = `${d.title} — ${d.content}`.slice(0, 500);
      const { data, error } = await supabase.from("personal_memory").insert({ company_id: ctx.active.companyId, content: note }).select("id").single();
      if (error || !data) {
        failed++;
        continue;
      }
      await supabase.from("knowledge_import_items").update({ status: "saved", saved_personal_id: data.id }).eq("id", d.itemId);
    } else {
      const { data, error } = await supabase
        .from("memory_entries")
        .insert({ space_id: d.destination, title: d.title, content: d.content, source_type: "import", source_ref: { import_id: run.id, source: run.source } })
        .select("id")
        .single();
      if (error || !data) {
        failed++;
        continue;
      }
      await indexEntry(supabase, ctx, { id: data.id, title: d.title, content: d.content });
      await supabase.from("knowledge_import_items").update({ status: "saved", saved_space_id: d.destination, saved_entry_id: data.id }).eq("id", d.itemId);
    }
    saved++;
  }
  if (refused.length) await supabase.from("knowledge_import_items").delete().in("id", refused);
  const { count } = await supabase.from("knowledge_import_items").select("id", { count: "exact", head: true }).eq("import_id", run.id).eq("status", "pending");
  await supabase
    .from("knowledge_imports")
    .update({ saved: run.saved + saved, ...(count ? {} : { status: "done", finished_at: new Date().toISOString() }) })
    .eq("id", run.id);
  revalidatePath("/memory/import");
  revalidatePath("/memory");
  return { ok: true, data: { saved, failed } };
}

/**
 * Deletes an import: its waiting proposals, and if asked what it added to memories (only what this
 * person may still delete there; an entry already edited by a colleague stays theirs to decide).
 */
export async function deleteImportAction(input: { importId: string; removeSaved: boolean }): Promise<ActionResult<{ removed: number }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ importId: z.uuid(), removeSaved: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  let removed = 0;
  if (parsed.data.removeSaved) {
    const { data: items } = await supabase.from("knowledge_import_items").select("saved_entry_id, saved_personal_id").eq("import_id", parsed.data.importId).eq("status", "saved");
    const entries = (items ?? []).map((i) => i.saved_entry_id).filter((id): id is string => Boolean(id));
    const notes = (items ?? []).map((i) => i.saved_personal_id).filter((id): id is string => Boolean(id));
    if (entries.length) removed += (await supabase.from("memory_entries").delete({ count: "exact" }).in("id", entries).eq("author_id", ctx.user.id)).count ?? 0;
    if (notes.length) removed += (await supabase.from("personal_memory").delete({ count: "exact" }).in("id", notes)).count ?? 0;
  }
  const { error } = await supabase.from("knowledge_imports").delete().eq("id", parsed.data.importId);
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/memory/import");
  revalidatePath("/memory");
  return { ok: true, data: { removed } };
}
