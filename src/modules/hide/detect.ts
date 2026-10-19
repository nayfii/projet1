import type { Span } from "./categories";
import { detectListTerms, type ListTerm } from "./detectors/lists";
import { detectAmounts, detectCards, detectEmails, detectIbans } from "./detectors/patterns";
import { detectPersons } from "./detectors/person";
import { detectPhones } from "./detectors/phone";
import { mergeSpans } from "./spans";

export type DetectionLists = {
  /** Clients, employees' names, the company's custom sensitive terms. */
  terms: ListTerm[];
  /** Employees' first names, added to the built-in first-name list. */
  firstNames: string[];
};

// "@Claude", "@ChatGPT", "@Gemini", "@IA": calling the AI in a group conversation, not a person's name.
const AI_MENTION = /^(?:claude|chatgpt|gpt|gemini|ia|ai)$/i;

/** Every sensitive passage found in the text, without overlaps (longest, then most specific, wins). */
export function detectSensitive(text: string, lists: DetectionLists): Span[] {
  if (!text.trim()) return [];
  return mergeSpans([
    ...detectIbans(text),
    ...detectCards(text),
    ...detectEmails(text),
    ...detectPhones(text),
    ...detectAmounts(text),
    ...detectListTerms(text, lists.terms),
    ...detectPersons(text, lists.firstNames),
  ]).filter((s) => !(text[s.start - 1] === "@" && AI_MENTION.test(text.slice(s.start, s.end))));
}
