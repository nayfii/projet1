/**
 * Search that forgives small typos ("strategie", "stratgie" find "Stratégie"): accents and case are
 * ignored, each word of the query must match a word of the text exactly, as a start, or within one or
 * two letters. Used for titles, categories and tags on screen; the database searches inside documents.
 */

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Damerau–Levenshtein distance, stopping early once above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    let best = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** How many typos a word of this length may hold. */
const tolerance = (length: number) => (length >= 8 ? 2 : length >= 4 ? 1 : 0);

function wordScore(q: string, word: string): number {
  if (word === q) return 1;
  if (word.startsWith(q)) return 0.9;
  if (q.length >= 3 && word.includes(q)) return 0.7;
  const allowed = tolerance(q.length);
  if (!allowed) return 0;
  // A typo inside the word, or in the part typed so far.
  const whole = editDistance(q, word, allowed);
  if (whole <= allowed) return 0.75 - whole * 0.1;
  const start = editDistance(q, word.slice(0, q.length), allowed);
  return start <= allowed ? 0.6 - start * 0.1 : 0;
}

/** 0 when the text does not match; otherwise higher is better (an exact phrase is best). */
export function matchScore(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) return 0;
  if (t === q) return 3;
  if (t.startsWith(q)) return 2.5;
  if (t.includes(q)) return 2;
  const words = t.split(" ");
  let total = 0;
  for (const part of q.split(" ")) {
    let best = 0;
    for (const w of words) best = Math.max(best, wordScore(part, w));
    if (!best) return 0;
    total += best;
  }
  return total / q.split(" ").length;
}

/** The items that match, best first (each item can be found by several texts: title, category, tags). */
export function rank<T>(query: string, items: T[], texts: (item: T) => (string | null | undefined)[], limit = 20): { item: T; score: number }[] {
  if (!normalize(query)) return [];
  return items
    .map((item) => {
      const [main, ...rest] = texts(item);
      // The title counts most; a category or a tag a little less.
      const score = Math.max(matchScore(query, main ?? "") * 1.2, ...rest.map((t) => matchScore(query, t ?? "") * 0.9));
      return { item, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** A short passage of the text around the first word of the query found (or the start of the text). */
export function snippet(text: string, query: string, length = 160): string {
  const clean = text.replace(/\[\[doc:[0-9a-f-]{36}\]\]/g, "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= length) return clean;
  const words = normalize(query).split(" ").filter((w) => w.length >= 3);
  const plain = clean.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
  let at = -1;
  for (const w of words) {
    at = plain.indexOf(w);
    if (at >= 0) break;
  }
  if (at < 0) return `${clean.slice(0, length).trimEnd()}…`;
  const from = Math.max(0, at - Math.floor(length / 3));
  const piece = clean.slice(from, from + length).trim();
  return `${from > 0 ? "…" : ""}${piece}${from + length < clean.length ? "…" : ""}`;
}
