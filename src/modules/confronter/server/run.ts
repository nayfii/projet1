import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import type { Json } from "@/lib/supabase/database.types";
import type { CatalogModel } from "@/modules/providers/catalog";
import { getProvider } from "@/modules/providers/server/registry";
import type { ChatMessage, ChatUsage } from "@/modules/providers/types";
import { computeCharge } from "@/modules/usage/credits";
import { getMyQuota } from "@/modules/usage/server/quota";
import { recordUsage } from "@/modules/usage/server/record";
import { citedPositions, toSourceProofs } from "@/modules/memory/citations";
import type { KnowledgePassage } from "@/modules/memory/types";
import type { BuiltContext } from "@/modules/conversations/context";
import type { ChatStreamEvent } from "@/modules/conversations/stream-events";
import { createAssistantMessage, finishAssistantMessage, isStopRequested, saveMessageSources } from "@/modules/conversations/server/assistant-writer";
import { CRITIQUE_SYSTEM, critiquePrompt, parseSynthesis, SYNTHESIS_SYSTEM, synthesisPrompt, toConfrontationModel } from "../prompts";
import { CONFRONT_MIN_MODELS, type Confrontation, type ConfrontationPart, type ConfrontationSynthesis } from "../types";

type CallResult = { model: CatalogModel; text: string; ok: boolean; usage: ChatUsage };

/**
 * Runs a confrontation (CLAUDE.md §4.5) on a question already authorised by `prepareChatTurn`
 * (conversation access, Hide, permission-filtered memory, group rules, quota): the models answer in
 * parallel with the same context, each critiques the others, the judge writes the synthesis. Every
 * call is charged as "confronter". It keeps running if the browser goes away; Stop ends it between stages.
 */
export async function* runConfrontation(p: {
  ctx: MemberContext;
  conversationId: string;
  question: { id: string; text: string; excerpt: string };
  models: CatalogModel[];
  judge: CatalogModel;
  context: BuiltContext;
  knowledge: KnowledgePassage[];
  /** Hide: real values back in place of placeholders, for what people see. */
  restore: (text: string) => string;
  contextLimited: boolean;
}): AsyncGenerator<ChatStreamEvent> {
  const meta: Record<string, Json> = { confronts: p.question.id };
  if (p.contextLimited) meta.context_limited = true;
  if (p.context.omittedMessages) meta.omitted_messages = p.context.omittedMessages;

  const confrontation: Confrontation = {
    questionId: p.question.id,
    questionExcerpt: p.question.excerpt,
    models: p.models.map(toConfrontationModel),
    judge: toConfrontationModel(p.judge),
    answers: [],
    critiques: [],
    synthesis: null,
    credits: 0,
  };
  let message: { id: string; seq: number };
  try {
    message = await createAssistantMessage({
      conversationId: p.conversationId,
      model: p.judge,
      routing: null,
      contextMeta: meta,
      confrontation: confrontation as unknown as Json,
    });
  } catch {
    yield { type: "error", code: "server_error", retryable: true };
    return;
  }
  yield {
    type: "meta",
    conversationId: p.conversationId,
    userMessage: null,
    assistantMessage: message,
    model: toConfrontationModel(p.judge),
    routing: null,
    replaces: null,
    omittedMessages: p.context.omittedMessages,
    contextLimited: p.contextLimited,
  };

  const stop = new AbortController();
  const watcher = setInterval(() => {
    if (!stop.signal.aborted) isStopRequested(message.id).then((requested) => requested && stop.abort()).catch(() => {});
  }, 1000);
  let credits = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const call = async (model: CatalogModel, system: string, messages: ChatMessage[], maxOutputTokens: number): Promise<CallResult> => {
    const started = Date.now();
    let text = "";
    let usage: ChatUsage | null = null;
    let failed: string | null = null;
    try {
      for await (const event of getProvider(model.provider).stream(
        { apiModelId: model.apiModelId, system, messages, maxOutputTokens: Math.min(model.maxOutputTokens, maxOutputTokens) },
        stop.signal,
      )) {
        if (event.type === "text") text += event.delta;
        else if (event.type === "usage") usage = event.usage;
        else if (event.type === "error") failed = event.error.code;
      }
    } catch {
      failed = "unknown";
    }
    const aborted = stop.signal.aborted && !failed;
    // Without provider counts (stopped, failed mid-way), tokens are estimated so stopping is never free.
    const counted: ChatUsage = usage ?? { inputTokens: Math.ceil(JSON.stringify(messages).length / 3.5), outputTokens: Math.ceil(text.length / 3.5), cachedInputTokens: 0 };
    const charge = computeCharge(model.pricing, counted);
    credits += charge.credits;
    inputTokens += counted.inputTokens;
    outputTokens += counted.outputTokens;
    await recordUsage({
      companyId: p.ctx.active.companyId,
      userId: p.ctx.user.id,
      feature: "confronter",
      conversationId: p.conversationId,
      messageId: message.id,
      provider: model.provider,
      modelId: model.id,
      apiModelId: model.apiModelId,
      autoRouted: false,
      inputTokens: counted.inputTokens,
      outputTokens: counted.outputTokens,
      cachedInputTokens: counted.cachedInputTokens,
      tokensEstimated: !usage,
      credits: charge.credits,
      estimatedCostUsd: charge.estimatedCostUsd,
      status: failed ? "error" : aborted ? "aborted" : "ok",
      errorCode: failed,
      latencyMs: Date.now() - started,
    });
    return { model, text: text.trim(), ok: !failed && !aborted && text.trim().length > 0, usage: counted };
  };

  const part = (r: CallResult): ConfrontationPart => ({ modelId: r.model.id, content: r.ok ? p.restore(r.text) : "", status: r.ok ? "complete" : "error" });
  const user = (text: string): ChatMessage[] => [{ role: "user", content: [{ type: "text", text }] }];
  let synthesis: ConfrontationSynthesis | null = null;
  let maskedRecommended = "";
  let failure: string | null = null;

  try {
    // 1. Every model answers the same question, with the same context.
    for (const m of p.models) yield { type: "confront", stage: "answer", modelId: m.id, status: "running" };
    const answers: CallResult[] = [];
    for await (const r of asTheyFinish(p.models.map((m) => call(m, p.context.system, p.context.messages, 4000)))) {
      answers.push(r);
      yield { type: "confront", stage: "answer", modelId: r.model.id, status: r.ok ? "complete" : "error" };
    }
    confrontation.answers = p.models.map((m) => part(answers.find((a) => a.model.id === m.id)!));
    const good = answers.filter((a) => a.ok);
    if (stop.signal.aborted) failure = "stopped";
    else if (good.length < CONFRONT_MIN_MODELS) failure = "confront_failed";

    // 2. Each model critiques the others' answers.
    const critiques: CallResult[] = [];
    if (!failure) {
      for (const a of good) yield { type: "confront", stage: "critique", modelId: a.model.id, status: "running" };
      const jobs = good.map((a) =>
        call(
          a.model,
          CRITIQUE_SYSTEM,
          user(critiquePrompt(p.question.text, good.filter((o) => o !== a).map((o) => ({ model: toConfrontationModel(o.model), content: o.text })))),
          2000,
        ),
      );
      for await (const r of asTheyFinish(jobs)) {
        critiques.push(r);
        yield { type: "confront", stage: "critique", modelId: r.model.id, status: r.ok ? "complete" : "error" };
      }
      confrontation.critiques = good.map((a) => part(critiques.find((c) => c.model.id === a.model.id)!));
      if (stop.signal.aborted) failure = "stopped";
    }

    // 3. The judge compares everything and recommends a combined answer.
    if (!failure) {
      yield { type: "confront", stage: "synthesis", modelId: p.judge.id, status: "running" };
      const r = await call(
        p.judge,
        SYNTHESIS_SYSTEM,
        user(
          synthesisPrompt(
            p.question.text,
            good.map((a) => ({ model: toConfrontationModel(a.model), content: a.text })),
            critiques.filter((c) => c.ok).map((c) => ({ model: toConfrontationModel(c.model), content: c.text })),
          ),
        ),
        6000,
      );
      yield { type: "confront", stage: "synthesis", modelId: p.judge.id, status: r.ok ? "complete" : "error" };
      if (r.ok) {
        const parsed = parseSynthesis(r.text);
        maskedRecommended = parsed.recommended;
        const restore = (items: string[]) => items.map(p.restore);
        synthesis = {
          agreements: restore(parsed.agreements),
          divergences: restore(parsed.divergences),
          errors: restore(parsed.errors),
          toVerify: restore(parsed.toVerify),
          recommended: p.restore(parsed.recommended),
        };
      } else {
        failure = stop.signal.aborted ? "stopped" : "confront_failed";
      }
    }
  } finally {
    clearInterval(watcher);
  }

  confrontation.synthesis = synthesis;
  confrontation.credits = Math.round(credits * 100) / 100;
  const content = synthesis?.recommended ?? "";
  // Source Proof: passages cited by the recommended answer.
  const sources = synthesis ? toSourceProofs(p.knowledge, citedPositions(maskedRecommended, p.knowledge.length)) : [];
  if (sources.length > 0) await saveMessageSources(message.id, p.conversationId, sources);
  await finishAssistantMessage(message.id, {
    content,
    maskedContent: synthesis && maskedRecommended !== content ? maskedRecommended : null,
    contextMeta: meta,
    confrontation: confrontation as unknown as Json,
    status: failure === "stopped" ? "stopped" : failure ? "error" : "complete",
    errorCode: failure && failure !== "stopped" ? failure : null,
    inputTokens,
    outputTokens,
  });

  yield { type: "confrontation", confrontation };
  if (failure === "stopped") return;
  if (failure) {
    yield { type: "error", code: "confront_failed", retryable: true };
    return;
  }
  yield { type: "delta", text: content };
  const quota = await getMyQuota(p.ctx.active.companyId);
  yield { type: "done", credits: confrontation.credits, quota: quota?.state ?? null, sources, masked: synthesis && maskedRecommended !== content ? maskedRecommended : null, suggestedColleagues: [] };
}

/** Yields each promise's result as soon as it settles (the calls never reject). */
async function* asTheyFinish<T>(promises: Promise<T>[]): AsyncGenerator<T> {
  const pending = new Map(promises.map((promise, i) => [i, promise.then((value) => ({ i, value }))]));
  while (pending.size > 0) {
    const { i, value } = await Promise.race(pending.values());
    pending.delete(i);
    yield value;
  }
}
