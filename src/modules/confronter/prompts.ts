import { modelDisplay, type CatalogModel } from "@/modules/providers/catalog";
import type { ProviderId } from "@/modules/providers/types";
import { computeCharge } from "@/modules/usage/credits";
import { parseModelJson } from "@/modules/memory/json";
import { CONFRONT_ESTIMATE, type ConfrontationModel, type ConfrontationSynthesis } from "./types";

const PROVIDER_ORDER: ProviderId[] = ["openai", "anthropic", "google"];

/** One model per allowed and configured provider (balanced tier first): ChatGPT, Claude, Gemini. */
export function confrontModels(allowed: CatalogModel[], configured: ReadonlySet<ProviderId>): CatalogModel[] {
  return PROVIDER_ORDER.flatMap((provider) => {
    if (!configured.has(provider)) return [];
    const candidates = allowed.filter((m) => m.provider === provider);
    const model = candidates.find((m) => m.tier === "balanced") ?? candidates[0];
    return model ? [model] : [];
  });
}

/** The synthesis is written by the model of the company default's provider when it takes part, else the first one. */
export function pickJudge(models: CatalogModel[], companyDefault: CatalogModel | undefined): CatalogModel {
  return models.find((m) => m.provider === companyDefault?.provider) ?? models[0];
}

export const toConfrontationModel = (m: CatalogModel): ConfrontationModel => ({ id: m.id, provider: m.provider, label: m.label });

/**
 * Credits for a whole confrontation (estimate shown before running): every model answers, every model
 * critiques the others' answers, the judge writes the synthesis. `contextTokens`: the question and its
 * history as the models will receive them.
 */
export function estimateConfrontation(models: CatalogModel[], judge: CatalogModel, contextTokens: number): number {
  const e = CONFRONT_ESTIMATE;
  const input = contextTokens + e.promptOverheadTokens;
  const charge = (m: CatalogModel, inputTokens: number, outputTokens: number) => computeCharge(m.pricing, { inputTokens, outputTokens, cachedInputTokens: 0 }).credits;
  const answers = models.reduce((n, m) => n + charge(m, input, e.answerTokens), 0);
  const critiques = models.reduce((n, m) => n + charge(m, input + (models.length - 1) * e.answerTokens, e.critiqueTokens), 0);
  const synthesis = charge(judge, input + models.length * (e.answerTokens + e.critiqueTokens), e.synthesisTokens);
  return Math.ceil(answers + critiques + synthesis);
}

/** A normal answer to the same question, for comparison ("about 7 times a normal question"). */
export function estimateSingleAnswer(model: CatalogModel, contextTokens: number): number {
  const e = CONFRONT_ESTIMATE;
  return Math.max(1, Math.ceil(computeCharge(model.pricing, { inputTokens: contextTokens + e.promptOverheadTokens, outputTokens: e.answerTokens, cachedInputTokens: 0 }).credits));
}

export const modelName = (m: ConfrontationModel) => {
  const { brand, name } = modelDisplay(m.provider, m.label);
  return `${brand} (${name})`;
};

export const CRITIQUE_SYSTEM = [
  "Task: critique answers.",
  "Other AI models answered the question below. Review their answers critically and fairly:",
  "- factual errors, weak or unsupported reasoning, missing important points;",
  "- claims that need to be verified before being relied on;",
  "- what each answer does well, in one line.",
  "Be concise and specific, name the answer you are talking about, and write in the language of the question.",
  "Citations such as [S1] refer to company documents you cannot see: do not count them as errors.",
  "Keep placeholders such as [CLIENT_1] exactly as written.",
].join("\n");

export const SYNTHESIS_SYSTEM = [
  "Task: synthesise a confrontation.",
  "Several AI models answered the same question, then critiqued each other's answers. Compare them and write a JSON object, in the language of the question, with exactly these keys:",
  '{"agreements": ["..."], "divergences": ["..."], "errors": ["..."], "to_verify": ["..."], "recommended": "..."}',
  "- agreements: points on which the answers agree;",
  "- divergences: where they differ, naming which model says what;",
  "- errors: errors or weak reasoning detected (by you or by the critiques), naming the model;",
  "- to_verify: claims a person should check before relying on them;",
  "- recommended: the best combined answer, complete and in Markdown, keeping citations such as [S1] where they support a point.",
  "Each list item is one short sentence; use an empty list when there is nothing. Keep placeholders such as [CLIENT_1] exactly as written.",
  "Answer with the JSON object only.",
].join("\n");

export function critiquePrompt(question: string, others: { model: ConfrontationModel; content: string }[]): string {
  return [`Question:\n${question}`, ...others.map((o) => `Answer from ${modelName(o.model)}:\n${o.content}`)].join("\n\n---\n\n");
}

export function synthesisPrompt(
  question: string,
  answers: { model: ConfrontationModel; content: string }[],
  critiques: { model: ConfrontationModel; content: string }[],
): string {
  return [
    `Question:\n${question}`,
    ...answers.map((a) => `Answer from ${modelName(a.model)}:\n${a.content}`),
    ...critiques.map((c) => `Critique by ${modelName(c.model)}:\n${c.content}`),
  ].join("\n\n---\n\n");
}

const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

/** Reads the judge's JSON; if it is not JSON, the whole text becomes the recommended answer. */
export function parseSynthesis(text: string): ConfrontationSynthesis {
  const json = parseModelJson(text) as Record<string, unknown> | null;
  if (!json || typeof json !== "object" || Array.isArray(json) || typeof json.recommended !== "string") {
    return { agreements: [], divergences: [], errors: [], toVerify: [], recommended: text.trim() };
  }
  return {
    agreements: list(json.agreements),
    divergences: list(json.divergences),
    errors: list(json.errors),
    toVerify: list(json.to_verify),
    recommended: json.recommended.trim(),
  };
}
