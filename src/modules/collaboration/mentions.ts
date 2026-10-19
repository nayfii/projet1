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
