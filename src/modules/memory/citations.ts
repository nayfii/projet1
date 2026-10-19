/** Positions cited in an answer, in order of first appearance: "… [S2] … [S1][S2]" → [2, 1]. */
export function citedPositions(text: string, available: number): number[] {
  const seen: number[] = [];
  for (const m of text.matchAll(/\[S(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= available && !seen.includes(n)) seen.push(n);
  }
  return seen;
}

/** Turns "[S1]" markers into Markdown links the answer renderer shows as small source badges. */
export function linkCitations(text: string): string {
  return text.replace(/\[S(\d{1,2})\](?!\()/g, "[S$1](#source-$1)");
}
