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

/** A colleague in the conversation, as a mention token ("Olivier", or "OlivierD" when two share a first name). */
export type PersonToken = { token: string; names: string[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mention tokens for the people of a conversation: their first name, made unique with their last name's initial. */
export function personTokens(people: { id: string; name: string }[]): Map<string, PersonToken> {
  const firsts = new Map<string, number>();
  const parts = people.map((p) => p.name.trim().split(/\s+/).filter(Boolean));
  for (const words of parts) if (words[0]) firsts.set(words[0].toLowerCase(), (firsts.get(words[0].toLowerCase()) ?? 0) + 1);
  const out = new Map<string, PersonToken>();
  people.forEach((p, i) => {
    const words = parts[i];
    if (!words[0]) return;
    const unique = firsts.get(words[0].toLowerCase()) === 1;
    const token = (unique || words.length < 2 ? words[0] : `${words[0]}${words[words.length - 1][0]}`).replace(/[^\p{L}\p{N}_-]/gu, "");
    if (!token) return;
    out.set(p.id, { token, names: [...new Set([words.join(" "), ...(unique ? [words[0]] : [])])] });
  });
  return out;
}

/** Whether a message mentions this person ("@Olivier"). */
export function mentionsPerson(text: string, person: PersonToken): boolean {
  return new RegExp(`(?:^|[\\s(,;:"«])@${escape(person.token)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/**
 * "Coucou Olivier, tu peux…" in a group: the colleague addressed at the start of the message is turned
 * into a mention ("Coucou @Olivier, tu peux…"), after a greeting or followed by a comma or colon.
 */
function naturalPersonMention(text: string, people: PersonToken[]): string {
  if (people.length === 0 || /(?:^|\s)@\p{L}/u.test(text.slice(0, 40))) return text;
  for (const person of people) {
    for (const name of [...person.names].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`^(\\s*(?:${GREETING}\\s*[,!]?\\s+)?)(${escape(name)})(?=([\\s,:!?]|$))(\\s*[,:])?`, "iu");
      const m = re.exec(text);
      if (!m) continue;
      const [, lead, matched, , punctuation] = m;
      if (!/\p{L}/u.test(lead) && !punctuation) continue;
      return `${lead}@${person.token}${text.slice(lead.length + matched.length)}`;
    }
  }
  return text;
}

/**
 * Natural mentions (CLAUDE.md §11), typed or dictated: "Coucou Claude, …" becomes "Coucou @Claude, …"
 * (and Claude answers), "Coucou Olivier, …" in a group becomes "Coucou @Olivier, …".
 */
export function naturalMention(text: string, people: PersonToken[] = []): string {
  const withPerson = naturalPersonMention(text, people);
  if (withPerson !== text) return withPerson;
  return naturalAssistantMention(text);
}

function naturalAssistantMention(text: string): string {
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
