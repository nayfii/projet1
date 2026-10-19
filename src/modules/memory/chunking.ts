/**
 * Splits a document's text into passages for the search index. Each passage keeps its exact position
 * in the extracted text (and its page for PDFs), so a Source Proof can open the exact passage.
 */
export type PageSpan = { page: number; start: number; end: number };
export type Chunk = { index: number; content: string; page: number | null; charStart: number; charEnd: number };

export const CHUNK_TARGET = 1100;
export const CHUNK_OVERLAP = 150;

export function chunkText(text: string, pages: PageSpan[] = [], target = CHUNK_TARGET, overlap = CHUNK_OVERLAP): Chunk[] {
  const chunks: Chunk[] = [];
  let start = skipSpaces(text, 0);
  while (start < text.length) {
    let end = Math.min(start + target, text.length);
    if (end < text.length) end = bestBreak(text, start, end);
    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({ index: chunks.length, content, page: pageAt(pages, start), charStart: start, charEnd: end });
    }
    if (end >= text.length) break;
    // Next passage starts a little before the end of this one, on a word boundary.
    let next = Math.max(end - overlap, start + 1);
    while (next < end && !/\s/.test(text[next - 1] ?? " ")) next++;
    start = skipSpaces(text, next);
  }
  return chunks;
}

/** Prefers a paragraph break, then a sentence end, then a space, in the last 40 % of the window. */
function bestBreak(text: string, start: number, end: number): number {
  const floor = start + Math.floor((end - start) * 0.6);
  const window = text.slice(floor, end);
  for (const pattern of [/\n\s*\n/g, /[.!?…]\s/g, /\n/g, /\s/g]) {
    let last = -1;
    for (const m of window.matchAll(pattern)) last = m.index! + m[0].length;
    if (last > 0) return floor + last;
  }
  return end;
}

function skipSpaces(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

function pageAt(pages: PageSpan[], position: number): number | null {
  return pages.find((p) => position >= p.start && position < p.end)?.page ?? null;
}
