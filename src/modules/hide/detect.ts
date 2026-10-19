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
  ]);
}
