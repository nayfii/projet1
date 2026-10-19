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
import { createAssistantMessage, finishAssistantMessage, isStopRequested, supersedeMessage } from "./assistant-writer";

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
  })
  .refine((v) => Boolean(v.message) !== Boolean(v.regenerate));

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
    .select("id, company_id, client_id, model_choice")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!conversation || conversation.company_id !== companyId) return fail("not_found", 404);

  const { data: rows } = await supabase
    .from("messages")
    .select(
      "id, seq, author_type, content, status, superseded_at, attachments:conversation_attachments!conversation_attachments_message_id_conversation_id_fkey(id, filename, kind, mime_type, storage_path, extracted_text, text_truncated)",
    )
    .eq("conversation_id", conversation.id)
    .order("seq");
  const visible = (rows ?? []).filter((r) => !r.superseded_at);

  // What is being answered: a new message, or the same question again (Regenerate).
  let base = visible;
  let target: (typeof visible)[number] | null = null;
  let pending: AttachmentRow[] = [];
  const newText = input.message?.content.trim() ?? "";
  if (input.regenerate) {
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
        .select("id, filename, kind, mime_type, storage_path, extracted_text, text_truncated")
        .eq("conversation_id", conversation.id)
        .eq("uploaded_by", ctx.user.id)
        .is("message_id", null)
        .in("id", ids);
      pending = data ?? [];
      if (pending.length !== ids.length) return fail("attachment_invalid", 400);
    }
    if (!newText && pending.length === 0) return fail("validation", 400);
  }

  // Model: the explicit choice, else the conversation's. Auto routes with simple rules.
  const models = await getCompanyModels(companyId);
  const choice = input.modelChoice ?? conversation.model_choice;
  const lastUser = [...base].reverse().find((r) => r.author_type === "user");
  const routedText = input.regenerate ? (lastUser?.content ?? "") : newText;
  const routedAttachments = (input.regenerate ? (lastUser?.attachments ?? []) : pending) as AttachmentRow[];
  const resolution = resolveModel(choice, models, {
    text: routedText,
    imageCount: routedAttachments.filter((a) => a.kind === "image").length,
    attachmentChars: routedAttachments.reduce((n, a) => n + (a.extracted_text?.length ?? 0), 0),
    historyTokens: base.reduce((n, r) => n + estimateTokens(r.content), 0),
  });
  if (!resolution.ok) {
    if (resolution.error === "model_not_allowed" || resolution.error === "auto_disabled") {
      await logBlockedRequest(companyId, ctx.user.id, resolution.error);
    }
    return fail(resolution.error, resolution.error === "missing_key" || resolution.error === "no_model_available" ? 503 : 409);
  }

  // Quotas are checked before any provider call: hard stop at 100 %.
  const quota = await getMyQuota(companyId);
  if (!quota) return fail("server_error", 500);
  if (quota.state.state === "blocked") {
    const reason = quota.state.scope === "user" ? "quota_user" : "quota_company";
    await logBlockedRequest(companyId, ctx.user.id, reason);
    return fail(reason === "quota_user" ? "quota_exceeded_user" : "quota_exceeded_company", 402);
  }

  if (input.modelChoice && input.modelChoice !== conversation.model_choice) {
    await supabase.from("conversations").update({ model_choice: input.modelChoice }).eq("id", conversation.id);
  }

  // Save the user's message with their own session (RLS proves they may write here).
  let userMessage: { id: string; seq: number } | null = null;
  if (input.message) {
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversation.id, content: newText })
      .select("id, seq")
      .single();
    if (error || !data) return fail("server_error", 500);
    userMessage = data;
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
    base = [...base, { id: data.id, seq: data.seq, author_type: "user", content: newText, status: "complete", superseded_at: null, attachments: pending }];
  }

  const history = await toHistory(supabase, base);
  const [companyRes, clientRes, locale] = await Promise.all([
    supabase.from("companies").select("name, industry, description").eq("id", companyId).single(),
    conversation.client_id
      ? supabase.from("clients").select("name, sector, description").eq("id", conversation.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    resolveLocale(),
  ]);
  const system = buildSystemPrompt({
    company: { name: companyRes.data?.name ?? ctx.active.companyName, industry: companyRes.data?.industry, description: companyRes.data?.description },
    client: clientRes.data,
    user: { name: ctx.profile.fullName },
    locale,
    today: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()),
  });
  const context = buildChatContext({ system, history, budgetTokens: contextBudget(models.allowed) });

  const { model, routing } = resolution;
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
        userMessage,
        target: target ? { id: target.id, complete: target.status === "complete" } : null,
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
  userMessage: { id: string; seq: number } | null;
  target: { id: string; complete: boolean } | null;
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
      contextMeta: p.context.omittedMessages ? { omitted_messages: p.context.omittedMessages } : null,
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
  };

  let text = "";
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
        yield { type: "delta", text: event.delta };
      } else if (event.type === "usage") {
        usage = event.usage;
      } else if (event.type === "error") {
        providerError = event.error;
      }
    }
  } finally {
    clearInterval(watcher);
  }

  const aborted = stop.signal.aborted && !providerError;
  const status = providerError ? "error" : aborted ? "stopped" : "complete";
  // Real provider counts whenever they exist. Otherwise (stopped, or failed mid-answer) estimate
  // from the text, so stopping an answer is never a way around the quota.
  const tokensEstimated = !usage && (aborted || text.length > 0);
  const counted: ChatUsage = usage ?? (tokensEstimated
    ? { inputTokens: p.context.estimatedTokens, outputTokens: estimateTokens(text), cachedInputTokens: 0 }
    : { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  const charge = computeCharge(p.model.pricing, counted);

  await finishAssistantMessage(assistant.id, {
    content: text,
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
  yield { type: "done", credits: charge.credits, quota: quota?.state ?? null };
}

/** Turns stored messages into context messages; images are re-sent only for recent messages. */
async function toHistory(
  supabase: UserClient,
  rows: { author_type: string; content: string; status: string; attachments?: unknown }[],
): Promise<HistoryMessage[]> {
  const usable = rows.filter(
    (r) => r.author_type === "user" || (r.status === "complete" && r.content) || (r.status === "stopped" && r.content),
  );
  const firstImageIndex = Math.max(usable.length - IMAGE_LOOKBACK_MESSAGES, 0);
  return Promise.all(
    usable.map(async (r, index) => {
      const attachments: HistoryAttachment[] = await Promise.all(
        ((r.attachments ?? []) as AttachmentRow[]).map(async (a) => {
          if (a.kind !== "image") {
            return { filename: a.filename, kind: "document" as const, text: a.extracted_text, truncated: a.text_truncated };
          }
          let image: HistoryAttachment["image"] = null;
          if (index >= firstImageIndex) {
            const { data } = await supabase.storage.from("chat-attachments").download(a.storage_path);
            if (data) image = { data: new Uint8Array(await data.arrayBuffer()), mediaType: a.mime_type };
          }
          return { filename: a.filename, kind: "image" as const, image };
        }),
      );
      return { role: r.author_type === "assistant" ? ("assistant" as const) : ("user" as const), text: r.content, attachments };
    }),
  );
}
