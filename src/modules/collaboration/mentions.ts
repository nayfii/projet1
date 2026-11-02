import type { CatalogModel } from "@/modules/providers/catalog";
import type { ProviderId } from "@/modules/providers/types";

/**
 * Group conversations: the AI answers only when mentioned (CLAUDE.md §4.4). @Claude, @ChatGPT and
 * @Gemini pick that provider; @AI (or @IA in French) uses the conversation's model or Auto.
 */
export type MentionTarget = ProviderId | "selected";

const MENTION = /(?:^|[\s(,;:"«])@(claude|chatgpt|gpt|gemini|ai|ia)(?![\p{L}\p{N}_])/iu;

export function parseMention(text: string): MentionTarget | null {
  const m = MENTION.exec(text);
  if (!m) return null;
  switch (m[1].toLowerCase()) {
    case "claude":
      return "anthropic";
    case "chatgpt":
    case "gpt":
      return "openai";
    case "gemini":
      return "google";
    default:
      return "selected";
  }
}

/**
 * Natural mentions (CLAUDE.md §11): in a group, "hello chat, tu peux…" or "Claude, peux-tu…" is
 * turned into a mention ("hello @ChatGPT, tu peux…") so the AI answers. Only when the assistant is
 * clearly addressed at the start of the message: after a greeting, or followed by a comma or colon.
 * Ambiguous words ("chat", "IA") need one of the two. A message that already mentions stays as it is.
 */
const GREETING = "(?:hello|hey|hi|salut|bonjour|bonsoir|coucou|ok|okay|dis|merci|yo|alors|please|stp)";
const NAMES: [RegExp, string][] = [
  [/^chat\s?gpt$/i, "ChatGPT"],
  [/^gpt$/i, "ChatGPT"],
  [/^chat$/i, "ChatGPT"],
  [/^claude$/i, "Claude"],
  [/^gemini$/i, "Gemini"],
  [/^(?:ia|ai)$/i, "IA"],
];
const ADDRESS = new RegExp(`^(\\s*(?:${GREETING}\\s*[,!]?\\s+)?)(chat\\s?gpt|gpt|chat|claude|gemini|ia|ai)(?=([\\s,:!?]|$))(\\s*[,:])?`, "iu");

export function naturalMention(text: string): string {
  if (parseMention(text)) return text;
  const m = ADDRESS.exec(text);
  if (!m) return text;
  const [, lead, name, , punctuation] = m;
  const greeted = /\p{L}/u.test(lead);
  const ambiguous = /^(?:chat|ia|ai)$/i.test(name);
  if (!greeted && !punctuation && (ambiguous || !/\S/.test(text.slice(m[0].length)))) return text;
  if (ambiguous && !greeted && !punctuation) return text;
  const token = NAMES.find(([re]) => re.test(name))?.[1];
  if (!token) return text;
  return `${lead}@${token}${text.slice(lead.length + name.length)}`;
}

/** The model that answers "@Claude" (etc.): an allowed, configured model of that provider, balanced tier first. */
export function modelForProvider(provider: ProviderId, allowed: CatalogModel[], configured: ReadonlySet<ProviderId>): CatalogModel | null {
  if (!configured.has(provider)) return null;
  const candidates = allowed.filter((m) => m.provider === provider);
  return candidates.find((m) => m.tier === "balanced") ?? candidates[0] ?? null;
}

/** Colleagues the answer suggests asking (Who Can Help): their full name, or a first name only one of them has. */
export function suggestedColleagues<T extends { userId: string; name: string }>(answer: string, colleagues: T[]): T[] {
  const text = answer.toLowerCase();
  const firstNames = new Map<string, number>();
  for (const c of colleagues) {
    const first = c.name.split(/\s+/)[0].toLowerCase();
    firstNames.set(first, (firstNames.get(first) ?? 0) + 1);
  }
  const contains = (needle: string) => new RegExp(`(?<![\\p{L}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu").test(text);
  return colleagues.filter((c) => {
    const full = c.name.toLowerCase();
    const first = full.split(/\s+/)[0];
    return contains(full) || (firstNames.get(first) === 1 && first.length >= 3 && contains(first));
  });
}
