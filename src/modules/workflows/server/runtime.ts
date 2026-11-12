import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserClient } from "@/lib/supabase/server";
import { createEphemeralMasker } from "@/modules/hide/server/masker";
import { loadCompanyLists } from "@/modules/hide/server/store";
import { indexEntry } from "@/modules/memory/server/indexer";
import { embeddingModelName, embeddingsAvailable, embedTexts, toVectorLiteral } from "@/modules/providers/server/embeddings";
import { defaultChoice, getCompanyModels, resolveModel } from "@/modules/providers/server/models";
import { getProvider } from "@/modules/providers/server/registry";
import type { ChatUsage } from "@/modules/providers/types";
import { computeCharge } from "@/modules/usage/credits";
import { evaluateQuota } from "@/modules/usage/quota";
import { recordUsage } from "@/modules/usage/server/record";

/**
 * A workflow runs with ITS AUTHOR'S rights, also when nobody is signed in (schedule, webhook, e-mail).
 * Our server acts for that person: every right is re-checked here at each run with the database's own
 * rules (company and membership active, the author's credits, the memories they may read or write);
 * nothing a workflow does goes beyond what its author could do by hand.
 */

export type Actor = { ctx: MemberContext; admin: ReturnType<typeof createAdminClient> };

export class RunStop extends Error {
  constructor(readonly code: "owner_inactive" | "quota_exceeded" | "no_model_available" | "provider_error" | "forbidden" | "not_found" | "timeout" | "invalid" | "interrupted" | "limit") {
    super(code);
  }
}

/** The author, as a member of the workflow's company today (or the run stops). */
export async function actorFor(companyId: string, userId: string): Promise<Actor> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_members")
    .select("role, admin_scopes, status, companies!inner(status, name)")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  const company = data?.companies as unknown as { status: string; name: string } | undefined;
  if (!data || data.status !== "active" || company?.status !== "active") throw new RunStop("owner_inactive");
  const ctx = {
    user: { id: userId, email: "" },
    active: { companyId, companyName: company.name, role: data.role, adminScopes: data.admin_scopes ?? [] },
    profile: { fullName: null },
  } as unknown as MemberContext;
  return { ctx, admin };
}

/**
 * One AI step: the author's credits first, the company's allowed models, the text masked by Hide (the
 * model gets placeholders; the answer gets the real values back), usage recorded as "workflow".
 */
export async function runAI(actor: Actor, task: { system: string; user: string; model?: string | null }): Promise<string> {
  const { ctx, admin } = actor;
  const { data: quotaRows } = await admin.rpc("workflow_quota_status", { p_company: ctx.active.companyId, p_user: ctx.user.id });
  const row = quotaRows?.[0];
  if (!row) throw new RunStop("quota_exceeded");
  const state = evaluateQuota({ periodStart: row.period_start, companyLimit: Number(row.company_limit), companyUsed: Number(row.company_used), userLimit: row.user_limit === null ? null : Number(row.user_limit), userUsed: Number(row.user_used) });
  if (state.state === "blocked") throw new RunStop("quota_exceeded");

  const models = await getCompanyModels(ctx.active.companyId, admin as unknown as UserClient);
  const resolution = resolveModel(task.model || defaultChoice(models), models, { text: task.user.slice(0, 2000), imageCount: 0, attachmentChars: 0, historyTokens: Math.ceil(task.user.length / 3.5) });
  if (!resolution.ok) throw new RunStop("no_model_available");
  const model = resolution.model;

  const masker = createEphemeralMasker(await loadCompanyLists(ctx.active.companyId, new Set()));
  const [masked] = await masker.mask([{ text: task.user, spans: masker.detect(task.user).filter((s) => s.category !== "amount") }]);

  const started = Date.now();
  let text = "";
  let usage: ChatUsage | null = null;
  let failed: string | null = null;
  for await (const event of getProvider(model.provider).stream(
    { apiModelId: model.apiModelId, system: task.system, messages: [{ role: "user", content: [{ type: "text", text: masked.masked }] }], maxOutputTokens: 3000 },
    new AbortController().signal,
  )) {
    if (event.type === "text") text += event.delta;
    else if (event.type === "usage") usage = event.usage;
    else if (event.type === "error") failed = event.error.code;
  }
  const counted = usage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const charge = computeCharge(model.pricing, counted);
  await recordUsage({
    companyId: ctx.active.companyId,
    userId: ctx.user.id,
    feature: "workflow",
    conversationId: null,
    messageId: null,
    provider: model.provider,
    modelId: model.id,
    apiModelId: model.apiModelId,
    autoRouted: Boolean(resolution.routing),
    inputTokens: counted.inputTokens,
    outputTokens: counted.outputTokens,
    cachedInputTokens: counted.cachedInputTokens,
    tokensEstimated: false,
    credits: charge.credits,
    estimatedCostUsd: charge.estimatedCostUsd,
    status: failed ? "error" : "ok",
    errorCode: failed,
    latencyMs: Date.now() - started,
  });
  if (failed) throw new RunStop("provider_error");
  return masker.restore(text);
}

/** "Recherche dans Consciousness": only the memories the author may read, as the chat would find them. */
export async function searchMemory(actor: Actor, query: string, limit: number): Promise<{ title: string; content: string; date: string | null }[]> {
  const { ctx, admin } = actor;
  const { data: spaces } = await admin.rpc("workflow_member_spaces", { p_company: ctx.active.companyId, p_user: ctx.user.id, p_write: false });
  const ids = (spaces ?? []) as unknown as string[];
  if (ids.length === 0 || !query.trim()) return [];
  let embedding: string | null = null;
  if (embeddingsAvailable()) {
    const started = Date.now();
    const result = await embedTexts([query.slice(0, 8000)]);
    if (result.ok) embedding = toVectorLiteral(result.vectors[0]);
    await recordUsage({
      companyId: ctx.active.companyId,
      userId: ctx.user.id,
      feature: "embedding",
      conversationId: null,
      messageId: null,
      provider: result.ok ? result.provider : "openai",
      modelId: embeddingModelName(),
      apiModelId: embeddingModelName(),
      autoRouted: false,
      inputTokens: result.ok ? result.tokens : 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      tokensEstimated: false,
      credits: 0,
      estimatedCostUsd: 0,
      status: result.ok ? "ok" : "error",
      errorCode: result.ok ? null : result.error.code,
      latencyMs: Date.now() - started,
    }).catch(() => undefined);
  }
  const { data } = await admin.rpc("match_memory", { p_space_ids: ids, p_keywords: query.slice(0, 500), p_embedding: embedding ?? undefined, p_limit: limit, p_embedding_model: embedding ? embeddingModelName() : undefined });
  return (data ?? []).map((r) => ({ title: r.title, content: r.content, date: r.source_date }));
}

/** "Ajouter à la Conscience": only into a memory the author may write in; indexed like any entry. */
export async function addMemoryEntry(actor: Actor, spaceId: string, entry: { title: string; content: string; workflowId: string; runId: string }): Promise<{ id: string }> {
  const { ctx, admin } = actor;
  const { data: spaces } = await admin.rpc("workflow_member_spaces", { p_company: ctx.active.companyId, p_user: ctx.user.id, p_write: true });
  if (!((spaces ?? []) as unknown as string[]).includes(spaceId)) throw new RunStop("forbidden");
  const { data, error } = await admin
    .from("memory_entries")
    .insert({
      space_id: spaceId,
      company_id: ctx.active.companyId,
      title: entry.title.slice(0, 200),
      content: entry.content.slice(0, 20_000),
      author_id: ctx.user.id,
      source_type: "workflow",
      source_ref: { workflow_id: entry.workflowId, run_id: entry.runId },
    })
    .select("id")
    .single();
  if (error || !data) throw new RunStop("forbidden");
  await indexEntry(admin as unknown as UserClient, ctx, { id: data.id, title: entry.title, content: entry.content }).catch(() => false);
  return { id: data.id };
}
