import type { KnowledgePassage, SourceProof } from "./types";

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

/** Source Proof: the passages an answer cited, as stored with the answer. */
export function toSourceProofs(knowledge: KnowledgePassage[], positions: number[]): SourceProof[] {
  return positions.map((position) => {
    const k = knowledge[position - 1];
    return {
      position,
      sourceType: k.sourceType,
      title: k.title,
      excerpt: k.content,
      page: k.page,
      sourceDate: k.sourceDate,
      spaceId: k.spaceId,
      spaceKind: k.spaceKind,
      clientName: k.clientName,
      documentId: k.documentId,
      entryId: k.sourceType === "memory_entry" ? k.id : null,
      chunkId: k.sourceType === "document_chunk" ? k.id : null,
      charStart: k.charStart,
      charEnd: k.charEnd,
    };
  });
}
