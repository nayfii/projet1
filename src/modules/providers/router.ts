import type { CatalogModel, ModelTier } from "./catalog";
import { estimateTokens, IMAGE_TOKEN_ESTIMATE } from "./tokens";

/**
 * Smart Router v1 (Auto mode): deterministic rules, no AI call. It classifies the request,
 * then picks among the company's allowed and configured models by tier, strengths and cost.
 * The decision is returned as codes so the UI can explain it in one line, in the user's language.
 */

export type TaskType = "quick" | "writing" | "analysis" | "code" | "long_context" | "vision" | "general";
export type RoutingBasis = "speed" | "quality" | "balance" | "capacity" | "vision";
export type RoutingDecision = { modelId: string; task: TaskType; basis: RoutingBasis };

export type RouterInput = {
  text: string;
  imageCount: number;
  /** Characters of document text attached to this message. */
  attachmentChars: number;
  /** Estimated tokens of the conversation so far. */
  historyTokens: number;
};

const LONG_CONTEXT_TOKENS = 30_000;
const QUICK_MAX_CHARS = 220;
const DEEP_ANALYSIS_CHARS = 1_500;

// Matched on lower-case text without accents, as whole words or prefixes.
const CODE = /```|\b(du code|ce code|mon code|this code|my code|some code|coder|script|function|fonction|python|javascript|typescript|sql|regex|json|debug|html|css|vba|macro|formule excel|excel formula)\b|=somme\(|=sum\(/;
const WRITING = /\b(redige|rediger|redaction|ecris|ecrire|reecris|reformule|reformuler|rephrase|rewrite|write|draft|compose|email|e-mail|mail|courrier|lettre|letter|post linkedin|linkedin|article|newsletter|slogan|annonce|communique|proposition commerciale|proposal|traduis|traduire|translate|corrige|relis|proofread)/;
const ANALYSIS = /\b(analyse|analyser|analyze|analysis|compare|comparer|comparison|pourquoi|why|strategie|strategy|evalue|evaluer|evaluate|calcule|calculer|calculate|prevision|forecast|risque|risk|avantages et inconvenients|pros and cons|recommande|recommend|plan d.action|action plan|marge|margin|rentabilite|profitability|diagnostic)/;

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function classifyTask(input: RouterInput): TaskType {
  if (input.imageCount > 0) return "vision";
  const needed = estimateTokens(input.text) + Math.ceil(input.attachmentChars / 3.5) + input.historyTokens;
  if (needed > LONG_CONTEXT_TOKENS) return "long_context";
  const text = normalize(input.text);
  if (CODE.test(text)) return "code";
  // When both appear, the first cue wins: "rédige un email sur la marge" is writing.
  const analysis = ANALYSIS.exec(text)?.index ?? Infinity;
  const writing = WRITING.exec(text)?.index ?? Infinity;
  if (analysis < writing) return "analysis";
  if (writing < analysis) return "writing";
  if (input.text.trim().length <= QUICK_MAX_CHARS && input.attachmentChars === 0) return "quick";
  return "general";
}

const PREFERENCES: Record<TaskType, { tier: ModelTier; strength: string | null; basis: RoutingBasis }> = {
  quick: { tier: "fast", strength: "speed", basis: "speed" },
  writing: { tier: "balanced", strength: "writing", basis: "quality" },
  analysis: { tier: "balanced", strength: "reasoning", basis: "quality" },
  code: { tier: "balanced", strength: "code", basis: "quality" },
  long_context: { tier: "balanced", strength: "long_context", basis: "capacity" },
  vision: { tier: "balanced", strength: "vision", basis: "vision" },
  general: { tier: "balanced", strength: null, basis: "balance" },
};

const TIER_RANK: Record<ModelTier, number> = { fast: 0, balanced: 1, advanced: 2 };

function blendedCost(m: CatalogModel): number {
  // Typical chat request: about 4 input tokens for 1 output token.
  return 4 * m.pricing.inputCreditsPerMtok + m.pricing.outputCreditsPerMtok;
}

/**
 * Picks a model among `models` (already filtered to allowed + enabled + configured).
 * Returns null when no model can take the request.
 */
export function routeRequest(input: RouterInput, models: CatalogModel[]): RoutingDecision | null {
  const task = classifyTask(input);
  const pref = { ...PREFERENCES[task] };
  // Long, detailed analysis questions deserve the most capable tier.
  if (task === "analysis" && input.text.length >= DEEP_ANALYSIS_CHARS) pref.tier = "advanced";

  const needed =
    estimateTokens(input.text) + Math.ceil(input.attachmentChars / 3.5) + input.historyTokens + input.imageCount * IMAGE_TOKEN_ESTIMATE;
  const candidates = models.filter(
    (m) => m.contextWindow - m.maxOutputTokens >= needed && (input.imageCount === 0 || m.supportsImages),
  );
  if (candidates.length === 0) return null;

  const costs = candidates.map(blendedCost);
  const maxCost = Math.max(...costs, 1);
  const scored = candidates.map((m, i) => {
    const tierDistance = Math.abs(TIER_RANK[m.tier] - TIER_RANK[pref.tier]);
    let score = 3 - 1.5 * tierDistance;
    if (pref.strength && m.strengths.includes(pref.strength)) score += 2;
    if (task === "long_context") score += m.contextWindow / 1_000_000;
    // Cheaper is better at equal fit (0 to -1).
    score -= costs[i] / maxCost;
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score || a.m.sortOrder - b.m.sortOrder);
  return { modelId: scored[0].m.id, task, basis: pref.basis };
}
