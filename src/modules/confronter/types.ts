import type { ProviderId } from "@/modules/providers/types";

/**
 * Confronter (CLAUDE.md §4.5): the allowed models each answer the same question, each critiques the
 * others' answers, and one synthesis lists agreements, divergences, errors, claims to verify and a
 * recommended combined answer. Stored on the answer message (`messages.confrontation`).
 */

export type ConfrontationModel = { id: string; provider: ProviderId; label: string };

export type ConfrontationPart = { modelId: string; content: string; status: "complete" | "error" };

export type ConfrontationSynthesis = {
  agreements: string[];
  divergences: string[];
  errors: string[];
  toVerify: string[];
  /** The recommended combined answer (Markdown); also the message's `content`. */
  recommended: string;
};

export type Confrontation = {
  questionId: string;
  /** The beginning of the question, shown above the confrontation. */
  questionExcerpt: string;
  models: ConfrontationModel[];
  /** The model that wrote the synthesis. */
  judge: ConfrontationModel;
  answers: ConfrontationPart[];
  critiques: ConfrontationPart[];
  synthesis: ConfrontationSynthesis | null;
  /** Credits actually charged for the whole confrontation. */
  credits: number;
};

/** Progress while it runs (browser only). */
export type ConfrontationStage = "answer" | "critique" | "synthesis";

export type ConfrontationProgress = { stage: ConfrontationStage; modelId: string; status: "running" | "complete" | "error" }[];

/** Expected output lengths, in tokens, for the credit estimate shown before running. */
export const CONFRONT_ESTIMATE = { answerTokens: 900, critiqueTokens: 600, synthesisTokens: 1400, promptOverheadTokens: 3000 } as const;

/** Minimum number of different providers needed for a confrontation to mean something. */
export const CONFRONT_MIN_MODELS = 2;

export function isConfrontation(value: unknown): value is Confrontation {
  return Boolean(value && typeof value === "object" && Array.isArray((value as Confrontation).models) && Array.isArray((value as Confrontation).answers));
}
