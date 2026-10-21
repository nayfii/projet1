import type { CatalogModel } from "@/modules/providers/catalog";
import type { ChatMessage, ContentPart } from "@/modules/providers/types";
import { estimateTokens, IMAGE_TOKEN_ESTIMATE } from "@/modules/providers/tokens";

/**
 * The single context builder (docs/ARCHITECTURE.md §1.1): the platform rebuilds the conversation
 * at every request, the same way whichever model answers. That is what makes "Continue with
 * Claude" work: the new model receives exactly what the previous one would have received.
 */

/** Upper bound for the context of one chat request, in estimated tokens (cost guard). */
export const CHAT_CONTEXT_CAP = 60_000;
/** Images older than this many messages are described in text instead of being re-sent. */
export const IMAGE_LOOKBACK_MESSAGES = 6;

export type HistoryAttachment = {
  filename: string;
  kind: "image" | "document" | "video";
  /** Videos: what the browser read before sending (duration in seconds, size in pixels). */
  media?: { duration: number; width: number; height: number } | null;
  text?: string | null;
  truncated?: boolean;
  /** Image bytes, loaded only for recent messages. */
  image?: { data: Uint8Array; mediaType: string } | null;
};

export type HistoryMessage = {
  role: "user" | "assistant";
  text: string;
  attachments?: HistoryAttachment[];
};

export type BuiltContext = {
  system: string;
  messages: ChatMessage[];
  /** Oldest messages left out to fit the budget. */
  omittedMessages: number;
  estimatedTokens: number;
};

/** Same budget for every model of the company: the smallest usable window among its allowed models. */
export function contextBudget(allowedModels: CatalogModel[]): number {
  const windows = allowedModels.map((m) => m.contextWindow - m.maxOutputTokens).filter((w) => w > 0);
  return Math.min(CHAT_CONTEXT_CAP, ...windows);
}

function renderMessage(message: HistoryMessage, documentCharAllowance = Infinity): { parts: ContentPart[]; tokens: number } {
  const parts: ContentPart[] = [];
  let tokens = 0;
  const texts: string[] = [];
  if (message.text.trim()) texts.push(message.text);

  const documents = (message.attachments ?? []).filter((a) => a.kind === "document");
  const perDocument = documents.length ? Math.floor(documentCharAllowance / documents.length) : Infinity;
  for (const a of message.attachments ?? []) {
    if (a.kind === "document") {
      let body = a.text ?? "";
      let truncated = Boolean(a.truncated);
      if (body.length > perDocument) {
        body = body.slice(0, Math.max(perDocument, 0));
        truncated = true;
      }
      const note = truncated ? "\n[Only the first part of this document is included.]" : "";
      texts.push(body ? `<attachment name="${a.filename}">\n${body}${note}\n</attachment>` : `[Attachment "${a.filename}": no readable text.]`);
    } else if (a.kind === "video") {
      // The model never receives the video itself, only what is needed to plan an edit.
      const m = a.media;
      const about = m && m.duration > 0 ? `: ${Math.round(m.duration * 10) / 10} s${m.width && m.height ? `, ${m.width}×${m.height}` : ""}` : "";
      texts.push(`[Video "${a.filename}"${about}. Its pictures and sound are not available to you.]`);
    } else if (a.image) {
      texts.push(`[Image attached: "${a.filename}"]`);
    } else {
      texts.push(`[Image "${a.filename}" was attached earlier in the conversation; it is not shown again.]`);
    }
  }
  const text = texts.join("\n\n");
  if (text) {
    parts.push({ type: "text", text });
    tokens += estimateTokens(text);
  }
  for (const a of message.attachments ?? []) {
    if (a.kind === "image" && a.image) {
      parts.push({ type: "image", data: a.image.data, mediaType: a.image.mediaType });
      tokens += IMAGE_TOKEN_ESTIMATE;
    }
  }
  return { parts, tokens };
}

/**
 * Builds the provider-agnostic request content. `history` is chronological and ends with the
 * message being answered (already saved). Errored, stopped-empty and replaced answers must be
 * filtered out by the caller.
 */
export function buildChatContext(options: { system: string; history: HistoryMessage[]; budgetTokens: number }): BuiltContext {
  const { system, history, budgetTokens } = options;
  const systemTokens = estimateTokens(system);
  if (history.length === 0) return { system, messages: [], omittedMessages: 0, estimatedTokens: systemTokens };

  // The newest message is always included; its documents are shortened if they alone exceed the budget.
  const newest = history[history.length - 1];
  let rendered = renderMessage(newest);
  const room = budgetTokens - systemTokens;
  if (rendered.tokens > room) {
    const otherTokens = renderMessage({ ...newest, attachments: newest.attachments?.filter((a) => a.kind !== "document") }).tokens;
    const allowanceChars = Math.max(Math.floor((room - otherTokens - 200) * 3.5), 2_000);
    rendered = renderMessage(newest, allowanceChars);
  }

  const kept: { role: "user" | "assistant"; parts: ContentPart[] }[] = [{ role: newest.role, parts: rendered.parts }];
  let used = systemTokens + rendered.tokens;
  let index = history.length - 2;
  for (; index >= 0; index--) {
    const m = history[index];
    const r = renderMessage(m);
    if (used + r.tokens > budgetTokens) break;
    kept.unshift({ role: m.role, parts: r.parts });
    used += r.tokens;
  }
  let omitted = index + 1;

  // Providers expect the conversation to start with a user turn.
  while (kept.length > 1 && kept[0].role === "assistant") {
    kept.shift();
    omitted++;
  }

  // Merge consecutive turns of the same role (e.g. after an answer that failed).
  const messages: ChatMessage[] = [];
  for (const k of kept) {
    const previous = messages.at(-1);
    if (previous && previous.role === k.role) {
      previous.content.push({ type: "text", text: "\n\n" }, ...k.parts);
    } else {
      messages.push({ role: k.role, content: [...k.parts] });
    }
  }
  for (const m of messages) {
    if (m.role === "assistant") {
      // Assistant turns are plain text.
      m.content = [{ type: "text", text: m.content.map((p) => (p.type === "text" ? p.text : "")).join("") }];
    }
  }

  const finalSystem =
    omitted > 0
      ? `${system}\n\nNote: the ${omitted} oldest message(s) of this conversation were left out because of length.`
      : system;
  return { system: finalSystem, messages, omittedMessages: omitted, estimatedTokens: used };
}
