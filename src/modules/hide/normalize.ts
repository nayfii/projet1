/**
 * Accent- and case-insensitive matching that still points back into the original text:
 * `fold` returns the folded text and, for each folded character, its index in the original.
 */

const SPECIAL: Record<string, string> = { œ: "oe", Œ: "oe", æ: "ae", Æ: "ae", ß: "ss", "’": "'", "‘": "'", " ": " ", " ": " " };

function foldChar(ch: string): string {
  return SPECIAL[ch] ?? ch.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

export type Folded = { folded: string; map: number[] };

export function fold(text: string): Folded {
  let folded = "";
  const map: number[] = [];
  let index = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let i = 0; i < f.length; i++) map.push(index);
    folded += f;
    index += ch.length;
  }
  map.push(text.length);
  return { folded, map };
}

/** Folded value with whitespace collapsed: the key for "same value" comparisons. */
export function foldKey(value: string): string {
  return fold(value).folded.replace(/\s+/g, " ").trim();
}

/** Removes accents but keeps the case (for case-sensitive comparisons of short names). */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").replace(/\s+/g, " ").trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Original [start, end) of a match found at [fStart, fEnd) in the folded text. */
export function originalRange(f: Folded, fStart: number, fEnd: number): { start: number; end: number } {
  const start = f.map[fStart];
  // The end maps to the character after the last folded character of the match.
  const last = f.map[fEnd - 1];
  let end = f.map[fEnd];
  if (end === last) end = last + 1;
  return { start, end };
}
