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
  /** Context Gateway: why it was given ("brief": a key fact of the client, always given; "search": found for the question). */
  reason?: "brief" | "search";
  /** Memory entries: what kind of fact it is (decision, commitment…). */
  kind?: string;
  /** Another current fact says something different about the same subject: the model must not pick one silently. */
  conflict?: boolean;
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

/** Context Gateway trace, saved on the answer: exactly what memory the model received (ids only). */
export type MemoryTrace = {
  /** What the model received: t = entry or document passage, s = memory, r = why. */
  used: { t: "e" | "d"; id: string; s: string; r: "brief" | "search" }[];
  /** The person's own recent messages given while their learning was not done yet. */
  recent: number;
  /** Time spent waiting for a learning in progress (ms). */
  waitedMs: number;
  /** Learnings still running when the answer started (their facts may be missing). */
  pending: number;
  /** Memories kept away from this provider by a company rule. */
  blocked: { spaceId: string; kind: "company" | "client"; clientName: string | null }[];
  /** Time the whole retrieval took (ms). */
  ms: number;
};

/** The learning of one answer (Cendr Consciousness), as stored: shown under the answer, never invented. */
export type LearningState = {
  jobId: string;
  status: "queued" | "running" | "done" | "skipped" | "failed";
  learned: number;
  confirmed: number;
  superseded: number;
  proposed: number;
  keptPrivate: number;
  forgotten: boolean;
};

export function toLearningState(row: {
  id: string;
  status: string;
  learned: number;
  confirmed: number;
  superseded: number;
  proposed: number;
  kept_private: number;
  forgotten_at: string | null;
}): LearningState {
  return {
    jobId: row.id,
    status: row.status as LearningState["status"],
    learned: row.learned,
    confirmed: row.confirmed,
    superseded: row.superseded,
    proposed: row.proposed,
    keptPrivate: row.kept_private,
    forgotten: row.forgotten_at !== null,
  };
}

export function isMemoryTrace(value: unknown): value is MemoryTrace {
  const v = value as MemoryTrace | null;
  return Boolean(v && Array.isArray(v.used) && typeof v.recent === "number" && Array.isArray(v.blocked));
}
