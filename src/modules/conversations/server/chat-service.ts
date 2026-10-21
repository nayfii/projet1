import "server-only";
import { z } from "zod";
import type { MemberContext } from "@/lib/auth/guards";
import { createClient, type UserClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { resolveLocale } from "@/i18n/request";
import type { CatalogModel } from "@/modules/providers/catalog";
import { getCompanyModels, resolveModel } from "@/modules/providers/server/models";
import { getProvider } from "@/modules/providers/server/registry";
import { estimateTokens } from "@/modules/providers/tokens";
import type { ChatUsage, ProviderError } from "@/modules/providers/types";
import { computeCharge } from "@/modules/usage/credits";
import { getMyQuota } from "@/modules/usage/server/quota";
import { logBlockedRequest, recordUsage } from "@/modules/usage/server/record";
import { buildChatContext, contextBudget, IMAGE_LOOKBACK_MESSAGES, type HistoryAttachment, type HistoryMessage } from "../context";
import { buildSystemPrompt } from "../system-prompt";
import type { ChatRequestError, ChatStreamEvent, RoutingInfo } from "../stream-events";
import { createAssistantMessage, finishAssistantMessage, isStopRequested, saveMessageSources, supersedeMessage } from "./assistant-writer";
import { retrievePassages } from "@/modules/memory/server/retrieval";
import { citedPositions, toSourceProofs } from "@/modules/memory/citations";
import type { KnowledgePassage } from "@/modules/memory/types";
import { HIDE_MODES, isHideMode, MAX_BLUR_CHARS, PLACEHOLDER_PATTERN, totalCount, type HideMode } from "@/modules/hide/categories";
import type { StreamRestorer } from "@/modules/hide/mask";
import { hideConfigured } from "@/modules/hide/server/crypto";
import { createConversationMasker, getHideSettings, loadDetectionLists, type Masker } from "@/modules/hide/server/masker";
import { logMaskingEvent, saveAttachmentMasks, saveMessageMask } from "@/modules/hide/server/store";
import { maskPassages, maskTurn } from "@/modules/hide/server/turn";
import { modelForProvider, parseMention, suggestedColleagues } from "@/modules/collaboration/mentions";
import { conversationScope, myMemorySpaces } from "@/modules/memory/server/retrieval";
import type { SuggestedColleague } from "../stream-events";
import { planConfrontation } from "@/modules/confronter/server/plan";
import { runConfrontation } from "@/modules/confronter/server/run";
import { resolveRunAgent } from "@/modules/agents/server/queries";
import { outputFormatInstruction } from "@/modules/agents/definitions";

const MODEL_CHOICE = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export const chatRequestSchema = z
  .object({
    conversationId: z.uuid(),
    modelChoice: z.string().regex(MODEL_CHOICE).optional(),
    message: z
      .object({
        content: z.string().max(100_000),
        attachmentIds: z.array(z.uuid()).max(5).default([]),
      })
      .optional(),
    regenerate: z.object({ messageId: z.uuid() }).optional(),
    // Confronter: the question (a person's message) the models answer, critique and synthesise.
    confront: z.object({ messageId: z.uuid() }).optional(),
    // Hide: modes for this message and, in Manual mode, the values blurred or left visible.
    hide: z
      .object({
        modes: z.array(z.enum(HIDE_MODES)).max(3),
        blur: z.array(z.string().min(1).max(MAX_BLUR_CHARS)).max(100).default([]),
        unblur: z.array(z.string().min(1).max(MAX_BLUR_CHARS)).max(100).default([]),
      })
      .optional(),
  })
  .refine((v) => [v.message, v.regenerate, v.confront].filter(Boolean).length === 1);

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

type Prepared =
  | { ok: false; error: ChatRequestError; status: number }
  | { ok: true; run: () => AsyncGenerator<ChatStreamEvent> };

type AttachmentRow = {
  id: string;
  filename: string;
  kind: string;
  mime_type: string;
  storage_path: string;
  extracted_text: string | null;
  text_truncated: boolean;
  masked_text: string | null;
  media: Json;
};

const fail = (error: ChatRequestError, status: number): Prepared => ({ ok: false, error, status });

/**
 * Everything that can be refused is checked here, before anything is saved or sent to a provider:
 * conversation access (RLS), model rules, quotas. Then `run` streams the answer and records usage.
 */
export async function prepareChatTurn(ctx: MemberContext, input: ChatRequestInput): Promise<Prepared> {
  const supabase = await createClient();
  const companyId = ctx.active.companyId;

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, company_id, client_id, model_choice, agent_id")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!conversation || conversation.company_id !== companyId) return fail("not_found", 404);
  // A conversation started from a tool or agent runs with its instructions, models and memory scope,
  // only while this person may still use it (CLAUDE.md §4.6, §4.7).
  const agent = conversation.agent_id ? await resolveRunAgent(supabase, ctx, conversation.agent_id) : null;
  if (conversation.agent_id && !agent) return fail("forbidden", 403);

  // Group conversation: several participants (CLAUDE.md §4.4).
  const { data: participantRows } = await supabase
    .from("conversation_participants")
    .select("user_id, visible_from_seq")
    .eq("conversation_id", conversation.id);
  const participants = participantRows ?? [];
  const group = participants.length > 1;

  const { data: rows } = await supabase
    .from("messages")
    .select(
      "id, seq, author_type, author_id, content, masked_content, hide_modes, status, superseded_at, attachments:conversation_attachments!conversation_attachments_message_id_conversation_id_fkey(id, filename, kind, mime_type, storage_path, extracted_text, text_truncated, masked_text, media)",
    )
    .eq("conversation_id", conversation.id)
    .order("seq");
  const visible = (rows ?? []).filter((r) => !r.superseded_at);

  // What is being answered: a new message, or the same question again (Regenerate).
  let base = visible;
  let target: (typeof visible)[number] | null = null;
  let pending: AttachmentRow[] = [];
  const newText = input.message?.content.trim() ?? "";
  if (input.confront) {
    const question = visible.find((r) => r.id === input.confront!.messageId);
    if (!question || question.author_type !== "user" || !question.content.trim()) return fail("not_found", 404);
    base = visible.filter((r) => r.seq <= question.seq && r.status !== "streaming");
  } else if (input.regenerate) {
    target = visible.find((r) => r.id === input.regenerate!.messageId) ?? null;
    if (!target || target.author_type !== "assistant" || visible.at(-1)?.id !== target.id || target.status === "streaming") {
      return fail("nothing_to_regenerate", 409);
    }
    base = visible.filter((r) => r.seq < target!.seq);
    if (!base.some((r) => r.author_type === "user")) return fail("nothing_to_regenerate", 409);
  } else {
    const ids = input.message!.attachmentIds;
    if (ids.length > 0) {
      const { data } = await supabase
        .from("conversation_attachments")
        .select("id, filename, kind, mime_type, storage_path, extracted_text, text_truncated, masked_text, media")
        .eq("conversation_id", conversation.id)
        .eq("uploaded_by", ctx.user.id)
        .is("message_id", null)
        .in("id", ids);
      pending = data ?? [];
      if (pending.length !== ids.length) return fail("attachment_invalid", 400);
      if (agent && !agent.tools.includes("attachments")) return fail("attachment_invalid", 400);
    }
    if (!newText && pending.length === 0) return fail("validation", 400);
  }

  // In a group, the AI answers only when mentioned (@Claude, @ChatGPT, @Gemini, @IA); Regenerate is
  // an explicit request too. Otherwise the message is simply posted for the others.
  const mention = input.message && group ? parseMention(newText) : null;
  const aiRequested = !group || Boolean(input.regenerate) || Boolean(input.confront) || mention !== null;

  // Model: the mentioned provider, else the explicit choice, else the conversation's. Auto routes with simple rules.
  const models = await getCompanyModels(companyId);
  let choice = input.modelChoice ?? conversation.model_choice;
  if (agent?.allowedModels.length && !agent.allowedModels.includes(choice)) {
    choice = agent.defaultModel && agent.allowedModels.includes(agent.defaultModel) ? agent.defaultModel : agent.allowedModels[0];
  }
  if (mention && mention !== "selected") {
    const mentioned = modelForProvider(mention, models.allowed, models.configured);
    if (!mentioned || (agent?.allowedModels.length && !agent.allowedModels.includes(mentioned.id))) return fail("model_not_allowed", 409);
    choice = mentioned.id;
  }
  const lastUser = [...base].reverse().find((r) => r.author_type === "user");
  const routedText = input.message ? newText : (lastUser?.content ?? "");
  const routedAttachments = (input.message ? pending : (lastUser?.attachments ?? [])) as AttachmentRow[];
  let resolution: Extract<ReturnType<typeof resolveModel>, { ok: true }> | null = null;
  // Confronter: one model per allowed provider; the cost is estimated and checked before any call.
  let confrontation: Extract<Awaited<ReturnType<typeof planConfrontation>>, { ok: true }> | null = null;
  if (input.confront) {
    const historyChars = base.reduce(
      (n, r) => n + r.content.length + ((r.attachments ?? []) as AttachmentRow[]).reduce((m, a) => m + (a.extracted_text?.length ?? 0), 0),
      0,
    );
    const plan = await planConfrontation(companyId, historyChars);
    if (!plan.ok) {
      if (plan.reason === "not_enough_models") return fail("confront_unavailable", 409);
      await logBlockedRequest(companyId, ctx.user.id, plan.reason);
      return fail(plan.reason === "quota_user" ? "quota_exceeded_user" : "quota_exceeded_company", 402);
    }
    if (!plan.enough) return fail("confront_too_expensive", 402);
    confrontation = plan;
  } else if (aiRequested) {
    const resolved = resolveModel(choice, models, {
      text: routedText,
      imageCount: routedAttachments.filter((a) => a.kind === "image").length,
      attachmentChars: routedAttachments.reduce((n, a) => n + (a.extracted_text?.length ?? 0), 0),
      historyTokens: base.reduce((n, r) => n + estimateTokens(r.content), 0),
    });
    if (!resolved.ok) {
      if (resolved.error === "model_not_allowed" || resolved.error === "auto_disabled") {
        await logBlockedRequest(companyId, ctx.user.id, resolved.error);
      }
      return fail(resolved.error, resolved.error === "missing_key" || resolved.error === "no_model_available" ? 503 : 409);
    }
    resolution = resolved;

    // Quotas are checked before any provider call: hard stop at 100 %.
    const quota = await getMyQuota(companyId);
    if (!quota) return fail("server_error", 500);
    if (quota.state.state === "blocked") {
      const reason = quota.state.scope === "user" ? "quota_user" : "quota_company";
      await logBlockedRequest(companyId, ctx.user.id, reason);
      return fail(reason === "quota_user" ? "quota_exceeded_user" : "quota_exceeded_company", 402);
    }
  }

  if (input.modelChoice && input.modelChoice !== conversation.model_choice) {
    await supabase.from("conversations").update({ model_choice: input.modelChoice }).eq("id", conversation.id);
  }

  const [companyRes, clientRes, locale, hideSettings] = await Promise.all([
    supabase.from("companies").select("name, industry, description").eq("id", companyId).single(),
    conversation.client_id
      ? supabase.from("clients").select("name, sector, description").eq("id", conversation.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    resolveLocale(),
    getHideSettings(supabase, companyId),
  ]);

  // Hide: masking happens here, on our server, before anything is saved or sent. A new message uses
  // the modes chosen above the input (company defaults otherwise); Regenerate reuses the question's.
  const hideModes: HideMode[] = input.message
    ? [...new Set(input.hide?.modes ?? hideSettings.defaultModes)]
    : (lastUser?.hide_modes ?? []).filter(isHideMode);
  const autoCategories = new Set(hideSettings.autoCategories);
  let masker: Masker | null = null;
  if (hideModes.length > 0 || base.some((r) => r.masked_content !== null)) {
    if (!hideConfigured()) return fail("hide_unavailable", 503);
    masker = await createConversationMasker(conversation.id, await loadDetectionLists(supabase, ctx));
  }
  // Who Can Help: colleagues with declared expertise who did not opt out (never from private
  // conversations). In a group, message authors are named too. Both are masked like other names.
  const [{ data: memberRows }, { data: authorRows }] = await Promise.all([
    aiRequested
      ? supabase
          .from("company_members")
          .select("user_id, expertise, status, who_can_help_opt_out, profile:profiles!company_members_user_id_fkey(full_name)")
          .eq("company_id", companyId)
      : Promise.resolve({ data: [] }),
    group
      ? supabase.from("profiles").select("id, full_name").in("id", [...new Set(base.map((r) => r.author_id).filter((id): id is string => Boolean(id)).concat(ctx.user.id))])
      : Promise.resolve({ data: [] }),
  ]);
  // People already in the conversation are not suggested: they are here.
  const participantIds = new Set(participants.map((p) => p.user_id));
  const colleagues = (memberRows ?? [])
    .filter((m) => m.status === "active" && !m.who_can_help_opt_out && !participantIds.has(m.user_id) && m.user_id !== ctx.user.id && m.expertise.length > 0 && m.profile?.full_name)
    .slice(0, 15)
    .map((m) => ({ userId: m.user_id, name: m.profile!.full_name!, expertise: m.expertise }));
  const authors = (authorRows ?? []).map((a) => ({ id: a.id, name: a.full_name?.trim() || "?" }));
  const facts = {
    userName: ctx.profile.fullName,
    companyDescription: companyRes.data?.description ?? null,
    client: clientRes.data ? { name: clientRes.data.name, sector: clientRes.data.sector, description: clientRes.data.description } : null,
    people: [...colleagues.map((c) => c.name), ...authors.map((a) => a.name)],
    toolInstructions: agent?.instructions ?? null,
  };
  const turn = masker
    ? await maskTurn(masker, {
        modes: hideModes,
        autoCategories,
        choices: { blur: input.hide?.blur ?? [], unblur: input.hide?.unblur ?? [] },
        text: input.message ? newText : null,
        attachments: pending,
        facts,
      })
    : null;
  const promptFacts = turn?.facts ?? facts;

  // Save the user's message with their own session (RLS proves they may write here).
  let userMessage: Extract<ChatStreamEvent, { type: "meta" }>["userMessage"] = null;
  if (input.message) {
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversation.id, content: newText })
      .select("id, seq")
      .single();
    if (error || !data) return fail("server_error", 500);
    if (pending.length > 0) {
      const { error: linkError } = await supabase
        .from("conversation_attachments")
        .update({ message_id: data.id })
        .in(
          "id",
          pending.map((a) => a.id),
        );
      if (linkError) return fail("server_error", 500);
    }
    const counts = turn && totalCount(turn.counts) > 0 ? turn.counts : null;
    if (hideModes.length > 0) {
      // What the model receives is stored by the server only, never by the browser.
      await saveMessageMask(data.id, { maskedContent: turn?.message ?? null, modes: hideModes, counts, spans: turn?.messageSpans.length ? turn.messageSpans : null });
      if (turn?.attachments.length) await saveAttachmentMasks(turn.attachments);
      if (counts) await logMaskingEvent({ companyId, userId: ctx.user.id, conversationId: conversation.id, counts, modes: hideModes });
    }
    const maskedAttachments = new Map((turn?.attachments ?? []).map((a) => [a.id, a.maskedText]));
    userMessage = { id: data.id, seq: data.seq, masked: counts ? { content: turn?.message ?? null, counts, spans: turn?.messageSpans ?? [] } : null };
    base = [
      ...base,
      {
        id: data.id,
        seq: data.seq,
        author_type: "user",
        author_id: ctx.user.id,
        content: newText,
        masked_content: turn?.message ?? null,
        hide_modes: hideModes,
        status: "complete",
        superseded_at: null,
        attachments: pending.map((a) => ({ ...a, masked_text: maskedAttachments.get(a.id) ?? null })),
      },
    ];
  }

  if (!aiRequested || (!resolution && !confrontation)) {
    const posted = userMessage!;
    return {
      ok: true,
      run: async function* () {
        yield { type: "posted", userMessage: posted };
      },
    };
  }

  // Group rule: the AI uses only the history every current participant can see…
  const contextFrom = group ? Math.max(...participants.map((p) => p.visible_from_seq)) : 1;
  const sharedBase = base.filter((r) => r.seq >= contextFrom);
  const historyLimited = sharedBase.length < base.length;
  const people = promptFacts.people;
  const authorLabel = new Map(authors.map((a, i) => [a.id, people[colleagues.length + i] ?? a.name]));
  const history = await toHistory(supabase, sharedBase, group ? authorLabel : null);
  // …and only the memories every participant may read (intersection of their permissions).
  let restrictTo: Set<string> | undefined;
  let memoryLimited = false;
  if (group) {
    const { data: shared } = await supabase.rpc("conversation_shared_spaces", { p_conversation: conversation.id });
    restrictTo = new Set((shared ?? []) as string[]);
    const mine = conversationScope(await myMemorySpaces(supabase, companyId), conversation.client_id);
    memoryLimited = mine.some((space) => !restrictTo!.has(space.spaceId));
  }
  // A tool may use only the company memory, or no memory at all.
  if (agent?.memoryScope === "company") {
    const companySpaces = (await myMemorySpaces(supabase, companyId)).filter((space) => space.kind === "company").map((space) => space.spaceId);
    restrictTo = new Set(companySpaces.filter((id) => !restrictTo || restrictTo.has(id)));
  }
  // Memory passages, filtered by permissions before any model sees them. The search by meaning uses
  // the masked question: the embeddings provider gets no more than the chat model.
  const embeddingQuery = input.message ? (turn?.message ?? newText) : (lastUser?.masked_content ?? routedText);
  const knowledge =
    agent?.memoryScope === "none" ? [] : await retrievePassages(supabase, ctx, { clientId: conversation.client_id, query: routedText, embeddingQuery, restrictTo });
  const promptKnowledge = masker ? await maskPassages(masker, knowledge, hideModes, autoCategories) : knowledge;
  const system = buildSystemPrompt({
    company: { name: companyRes.data?.name ?? ctx.active.companyName, industry: companyRes.data?.industry, description: promptFacts.companyDescription },
    client: promptFacts.client,
    user: { name: promptFacts.userName },
    locale,
    today: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()),
    knowledge: promptKnowledge,
    protectedValues: masker !== null,
    colleagues: colleagues.map((c, i) => ({ name: people[i] ?? c.name, expertise: c.expertise })),
    group,
    tool: agent ? { name: agent.name, instructions: promptFacts.toolInstructions ?? agent.instructions, format: outputFormatInstruction(agent.outputFormat) } : null,
  });
  const context = buildChatContext({ system, history, budgetTokens: contextBudget(models.allowed) });
  // In a group, only values the model was shown are put back: a placeholder it invents can never
  // reveal a value from history that some participants cannot see.
  const shownPlaceholders = group ? contextPlaceholders(context) : undefined;

  if (confrontation) {
    const question = lastUser!;
    // The question must be part of what everyone here can see (a group may have joined later).
    if (question.seq < contextFrom) return fail("confront_unavailable", 409);
    return {
      ok: true,
      run: () =>
        runConfrontation({
          ctx,
          conversationId: conversation.id,
          question: { id: question.id, text: question.masked_content ?? question.content, excerpt: question.content.slice(0, 200) },
          models: confrontation.models,
          judge: confrontation.judge,
          context,
          knowledge,
          restore: (text) => {
            if (!masker) return text;
            const restorer = masker.restorer(shownPlaceholders);
            return restorer.push(text) + restorer.flush();
          },
          contextLimited: group && (historyLimited || memoryLimited),
        }),
    };
  }

  const { model, routing } = resolution!;
  const routingInfo: RoutingInfo | null = routing ? { mode: "auto", task: routing.task, basis: routing.basis } : null;

  return {
    ok: true,
    run: () =>
      runTurn({
        supabase,
        ctx,
        conversationId: conversation.id,
        model,
        routing: routingInfo,
        context,
        knowledge,
        userMessage,
        target: target ? { id: target.id, complete: target.status === "complete" } : null,
        restorer: masker?.restorer(shownPlaceholders) ?? null,
        contextLimited: group && (historyLimited || memoryLimited),
        colleagues: colleagues.map((c) => ({ userId: c.userId, name: c.name })),
      }),
  };
}

async function* runTurn(p: {
  supabase: UserClient;
  ctx: MemberContext;
  conversationId: string;
  model: CatalogModel;
  routing: RoutingInfo | null;
  context: ReturnType<typeof buildChatContext>;
  knowledge: KnowledgePassage[];
  userMessage: Extract<ChatStreamEvent, { type: "meta" }>["userMessage"];
  target: { id: string; complete: boolean } | null;
  /** Hide: puts real values back in place of placeholders as the answer streams. */
  restorer: StreamRestorer | null;
  contextLimited: boolean;
  /** Who Can Help: colleagues the answer may suggest (real names). */
  colleagues: SuggestedColleague[];
}): AsyncGenerator<ChatStreamEvent> {
  const started = Date.now();
  // A failed or stopped answer is replaced right away; a good one only once the new one succeeds.
  if (p.target && !p.target.complete) await supersedeMessage(p.target.id, p.conversationId);

  let assistant: { id: string; seq: number };
  try {
    assistant = await createAssistantMessage({
      conversationId: p.conversationId,
      model: p.model,
      routing: p.routing as Json | null,
      contextMeta: contextMeta(p.context.omittedMessages, p.contextLimited, []),
    });
  } catch {
    yield { type: "error", code: "server_error", retryable: true };
    return;
  }

  yield {
    type: "meta",
    conversationId: p.conversationId,
    userMessage: p.userMessage,
    assistantMessage: assistant,
    model: { id: p.model.id, provider: p.model.provider, label: p.model.label },
    routing: p.routing,
    replaces: p.target?.id ?? null,
    omittedMessages: p.context.omittedMessages,
    contextLimited: p.contextLimited,
  };

  // `text` is what the model wrote (with placeholders); `shown` has the real values restored.
  let text = "";
  let shown = "";
  let usage: ChatUsage | null = null;
  let providerError: ProviderError | null = null;
  // The answer is written to the end even if the browser goes away (reload, closed tab):
  // only the Stop button stops it, through a flag checked every second.
  const stop = new AbortController();
  const watcher = setInterval(() => {
    if (stop.signal.aborted) return;
    isStopRequested(assistant.id)
      .then((requested) => requested && stop.abort())
      // A failed check is retried a second later; it must never crash the server.
      .catch(() => {});
  }, 1000);
  const provider = getProvider(p.model.provider);
  try {
    for await (const event of provider.stream(
      {
        apiModelId: p.model.apiModelId,
        system: p.context.system,
        messages: p.context.messages,
        maxOutputTokens: Math.min(p.model.maxOutputTokens, 16_000),
      },
      stop.signal,
    )) {
      if (event.type === "text") {
        text += event.delta;
        const out = p.restorer ? p.restorer.push(event.delta) : event.delta;
        if (out) {
          shown += out;
          yield { type: "delta", text: out };
        }
      } else if (event.type === "usage") {
        usage = event.usage;
      } else if (event.type === "error") {
        providerError = event.error;
      }
    }
  } finally {
    clearInterval(watcher);
  }
  const rest = p.restorer?.flush();
  if (rest) {
    shown += rest;
    yield { type: "delta", text: rest };
  }
  const masked = p.restorer && shown !== text ? text : null;
  const suggested = suggestedColleagues(shown, p.colleagues).map((c) => ({ userId: c.userId, name: c.name }));

  const aborted = stop.signal.aborted && !providerError;
  const status = providerError ? "error" : aborted ? "stopped" : "complete";
  // Real provider counts whenever they exist. Otherwise (stopped, or failed mid-answer) estimate
  // from the text, so stopping an answer is never a way around the quota.
  const tokensEstimated = !usage && (aborted || text.length > 0);
  const counted: ChatUsage = usage ?? (tokensEstimated
    ? { inputTokens: p.context.estimatedTokens, outputTokens: estimateTokens(text), cachedInputTokens: 0 }
    : { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  const charge = computeCharge(p.model.pricing, counted);

  // Source Proof: the passages the answer actually cited. Saved first: other participants reload the
  // answer when it is marked finished (real time), and must find its sources by then.
  const sources = toSourceProofs(p.knowledge, citedPositions(text, p.knowledge.length));
  if (sources.length > 0) await saveMessageSources(assistant.id, p.conversationId, sources);
  await finishAssistantMessage(assistant.id, {
    content: shown,
    maskedContent: masked,
    contextMeta: contextMeta(p.context.omittedMessages, p.contextLimited, suggested),
    status,
    errorCode: providerError?.code ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  });
  await recordUsage({
    companyId: p.ctx.active.companyId,
    userId: p.ctx.user.id,
    feature: "chat",
    conversationId: p.conversationId,
    messageId: assistant.id,
    provider: p.model.provider,
    modelId: p.model.id,
    apiModelId: p.model.apiModelId,
    autoRouted: Boolean(p.routing),
    inputTokens: counted.inputTokens,
    outputTokens: counted.outputTokens,
    cachedInputTokens: counted.cachedInputTokens,
    tokensEstimated,
    credits: charge.credits,
    estimatedCostUsd: charge.estimatedCostUsd,
    status: providerError ? "error" : aborted ? "aborted" : "ok",
    errorCode: providerError?.code ?? null,
    latencyMs: Date.now() - started,
  });
  if (status === "complete" && p.target?.complete) await supersedeMessage(p.target.id, p.conversationId);

  if (providerError) {
    yield { type: "error", code: providerError.code, retryable: providerError.retryable };
    return;
  }
  if (aborted) return;
  const quota = await getMyQuota(p.ctx.active.companyId);
  yield { type: "done", credits: charge.credits, quota: quota?.state ?? null, sources, masked, suggestedColleagues: suggested };
}

function contextPlaceholders(context: ReturnType<typeof buildChatContext>): Set<string> {
  const texts = [context.system, ...context.messages.flatMap((m) => m.content.flatMap((part) => (part.type === "text" ? [part.text] : [])))];
  return new Set(texts.flatMap((text) => [...text.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[0])));
}

function contextMeta(omitted: number, limited: boolean, suggested: SuggestedColleague[]): Json | null {
  const meta: Record<string, Json> = {};
  if (omitted) meta.omitted_messages = omitted;
  if (limited) meta.context_limited = true;
  if (suggested.length) meta.suggested_colleagues = suggested;
  return Object.keys(meta).length ? meta : null;
}

/**
 * Turns stored messages into context messages; images are re-sent only for recent messages. In a
 * group, people's messages start with their (masked) name so the model knows who said what.
 */
async function toHistory(
  supabase: UserClient,
  rows: { author_type: string; author_id?: string | null; content: string; masked_content?: string | null; status: string; attachments?: unknown }[],
  authorLabel: Map<string, string> | null,
): Promise<HistoryMessage[]> {
  const usable = rows.filter(
    (r) => r.author_type === "user" || (r.status === "complete" && r.content) || (r.status === "stopped" && r.content),
  );
  const firstImageIndex = Math.max(usable.length - IMAGE_LOOKBACK_MESSAGES, 0);
  return Promise.all(
    usable.map(async (r, index) => {
      const attachments: HistoryAttachment[] = await Promise.all(
        ((r.attachments ?? []) as AttachmentRow[]).map(async (a) => {
          if (a.kind === "video") return { filename: a.filename, kind: "video" as const, media: (a.media as HistoryAttachment["media"]) ?? null };
          if (a.kind !== "image") {
            // Hide: the masked text when Documents mode masked something in this file.
            return { filename: a.filename, kind: "document" as const, text: a.masked_text ?? a.extracted_text, truncated: a.text_truncated };
          }
          let image: HistoryAttachment["image"] = null;
          if (index >= firstImageIndex) {
            const { data } = await supabase.storage.from("chat-attachments").download(a.storage_path);
            if (data) image = { data: new Uint8Array(await data.arrayBuffer()), mediaType: a.mime_type };
          }
          return { filename: a.filename, kind: "image" as const, image };
        }),
      );
      // Hide: models always receive the masked version of earlier messages.
      const body = r.masked_content ?? r.content;
      const label = authorLabel && r.author_type === "user" && r.author_id ? authorLabel.get(r.author_id) : null;
      return { role: r.author_type === "assistant" ? ("assistant" as const) : ("user" as const), text: label ? `${label}: ${body}` : body, attachments };
    }),
  );
}
