import nlp from "compromise";
import type { Span } from "../categories";
import { AMBIGUOUS_FIRST_NAMES, FIRST_NAMES } from "../first-names";
import { foldKey } from "../normalize";

/**
 * Person names, detected locally on our server: the compromise library (English names) plus rules
 * for French usage: titles (M., Mme, Maître…), known first names followed by capitalised surnames,
 * particles (de, Le, van…) and surnames in capitals (Jean DUPONT). Recall is imperfect.
 */

const HONORIFICS = new Set([
  "m", "mme", "mmes", "mlle", "mlles", "monsieur", "madame", "mademoiselle", "maitre", "me", "dr", "docteur", "pr",
  "professeur", "mr", "mrs", "ms", "miss", "sir", "dame",
]);
const PARTICLES = new Set(["de", "du", "des", "le", "la", "van", "von", "der", "den", "di", "da", "del", "dos", "ben", "bin", "ibn", "el", "al"]);
const WORD = /\p{L}[\p{L}'’-]*/gu;

type Token = { text: string; start: number; end: number };

const isCapitalized = (t: string) => /^\p{Lu}/u.test(t);
const isSurname = (t: string) => (/^\p{Lu}[\p{L}'’-]+$/u.test(t) && !t.endsWith("-")) || /^[dD]['’]\p{Lu}\p{L}+$/u.test(t);

function atSentenceStart(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /[\s"«“'(\-–—•*]/.test(text[i])) i--;
  return i < 0 || /[.!?:;\n]/.test(text[i]);
}

export function detectPersons(text: string, extraFirstNames: Iterable<string> = []): Span[] {
  const names = new Set(FIRST_NAMES);
  for (const n of extraFirstNames) if (n.trim().length >= 2) names.add(foldKey(n));
  const isFirstName = (t: string) => {
    const key = foldKey(t);
    if (names.has(key)) return true;
    const parts = key.split("-");
    return parts.length > 1 && names.has(parts[0]) && parts.every((p) => p.length > 0);
  };

  const tokens: Token[] = [...text.matchAll(WORD)].map((m) => ({ text: m[0].replace(/['’-]+$/, ""), start: m.index, end: m.index + m[0].replace(/['’-]+$/, "").length }));
  const spans: Span[] = [];

  /** Index of the last token of the surname that follows token `i` (i itself if none). */
  const extendSurname = (i: number): number => {
    let last = i;
    let j = i + 1;
    let added = 0;
    while (j < tokens.length && added < 4 && /^[  ]$/.test(text.slice(tokens[j - 1].end, tokens[j].start))) {
      const t = tokens[j].text;
      if (isSurname(t) && !HONORIFICS.has(foldKey(t))) {
        last = j;
        j++;
        added++;
      } else if (PARTICLES.has(t.toLowerCase()) && j + 1 < tokens.length && /^[  ]$/.test(text.slice(tokens[j].end, tokens[j + 1].start)) && isSurname(tokens[j + 1].text)) {
        last = j + 1;
        j += 2;
        added += 2;
      } else {
        break;
      }
    }
    return last;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!isCapitalized(tok.text)) continue;
    const key = foldKey(tok.text);

    // "M. Dupont", "Mme Nguyen", "Dr Emily Watson": the title stays visible, the name is masked.
    if (HONORIFICS.has(key) && i + 1 < tokens.length && /^\.?[  ]{1,2}$/.test(text.slice(tok.end, tokens[i + 1].start))) {
      const next = tokens[i + 1];
      if (isSurname(next.text) || isFirstName(next.text)) {
        const last = extendSurname(i + 1);
        spans.push({ start: next.start, end: tokens[last].end, category: "person" });
        i = last;
        continue;
      }
    }

    if (isFirstName(tok.text)) {
      const last = extendSurname(i);
      if (last === i && AMBIGUOUS_FIRST_NAMES.has(key) && atSentenceStart(text, tok.start)) continue;
      spans.push({ start: tok.start, end: tokens[last].end, category: "person" });
      i = last;
    }
  }

  for (const person of nlp(text).people().json({ offset: true }) as { offset: { start: number; length: number } }[]) {
    let start = person.offset.start;
    let end = start + person.offset.length;
    while (end > start && !/[\p{L}]/u.test(text[end - 1])) end--;
    // Leave titles visible, like the rules above.
    const first = /^(\p{L}+)\.?\s+/u.exec(text.slice(start, end));
    if (first && HONORIFICS.has(foldKey(first[1]))) start += first[0].length;
    if (end <= start || !isCapitalized(text[start])) continue;
    const single = !/\s/.test(text.slice(start, end));
    if (single && AMBIGUOUS_FIRST_NAMES.has(foldKey(text.slice(start, end))) && atSentenceStart(text, start)) continue;
    spans.push({ start, end, category: "person" });
  }
  return spans;
}
