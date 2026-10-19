/** A passage found in memory and given to the model, numbered [S1], [S2]… in the prompt. */
export type KnowledgePassage = {
  position: number;
  sourceType: "document_chunk" | "memory_entry";
  id: string;
  documentId: string | null;
  spaceId: string;
  spaceKind: "company" | "client";
  clientName: string | null;
  title: string;
  content: string;
  page: number | null;
  charStart: number | null;
  charEnd: number | null;
  sourceDate: string | null;
};

/** Source Proof shown under an answer: the exact passage the answer cited, and where it comes from. */
export type SourceProof = {
  position: number;
  sourceType: "document_chunk" | "memory_entry";
  title: string;
  excerpt: string;
  page: number | null;
  sourceDate: string | null;
  spaceId: string | null;
  spaceKind: "company" | "client" | null;
  clientName: string | null;
  documentId: string | null;
  entryId: string | null;
  chunkId?: string | null;
  charStart: number | null;
  charEnd: number | null;
};
