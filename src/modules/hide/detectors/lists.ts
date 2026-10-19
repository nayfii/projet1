import type { HideCategory, Span } from "../categories";
import { CATEGORY_PRIORITY } from "../categories";
import { escapeRegExp, fold, foldKey, originalRange, stripAccents } from "../normalize";

/** A name from the company's own lists: clients, employees, custom sensitive terms. */
export type ListTerm = { term: string; category: Extract<HideCategory, "client" | "project" | "file" | "term" | "person"> };

/**
 * Finds the company's terms, ignoring accents and case ("societe generale" finds "Société Générale").
 * A term with a very short word ("Client A") must match its capitals, so "le client a payé" is not taken
 * for the client "Client A".
 */
export function detectListTerms(text: string, terms: ListTerm[]): Span[] {
  const byKey = new Map<string, ListTerm>();
  for (const t of terms) {
    const key = foldKey(t.term);
    if (key.length < 2) continue;
    const existing = byKey.get(key);
    if (!existing || CATEGORY_PRIORITY[t.category] > CATEGORY_PRIORITY[existing.category]) byKey.set(key, t);
  }
  if (byKey.size === 0) return [];

  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.map((k) => escapeRegExp(k).replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  const f = fold(text);
  const spans: Span[] = [];
  for (const m of f.folded.matchAll(pattern)) {
    const term = byKey.get(m[0].replace(/\s+/g, " "));
    if (!term) continue;
    const { start, end } = originalRange(f, m.index, m.index + m[0].length);
    const hasShortWord = term.term.trim().split(/\s+/).some((w) => w.length < 3);
    if (hasShortWord && stripAccents(text.slice(start, end)) !== stripAccents(term.term)) continue;
    spans.push({ start, end, category: term.category });
  }
  return spans;
}
