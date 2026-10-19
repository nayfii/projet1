/**
 * Hide (CLAUDE.md §4.3): modes, categories and placeholders. Shared by the server (detection,
 * masking) and the browser (mode control, highlights). Pure, no dependencies.
 */

export const HIDE_MODES = ["automatic", "documents", "manual"] as const;
export type HideMode = (typeof HIDE_MODES)[number];

/** Categories Automatic and Documents modes can mask; admins choose which ones (company settings). */
export const AUTO_CATEGORIES = ["iban", "card", "email", "phone", "amount", "person", "client", "project", "file", "term"] as const;
export type AutoCategory = (typeof AUTO_CATEGORIES)[number];

/** "redacted" = a passage the person selected and blurred by hand (Manual mode). */
export type HideCategory = AutoCategory | "redacted";

export const DEFAULT_MODES: HideMode[] = ["automatic", "documents"];
/** Longest passage that can be blurred by hand in one selection (Manual mode). */
export const MAX_BLUR_CHARS = 5000;
/** Amounts are off by default: masking them breaks finance questions (open question 4, docs/STATUS.md). */
export const DEFAULT_AUTO_CATEGORIES: AutoCategory[] = AUTO_CATEGORIES.filter((c) => c !== "amount");

/** A detected or chosen sensitive passage: [start, end) in the text. */
export type Span = { start: number; end: number; category: HideCategory };

/** On equal length, the more specific detection wins. */
export const CATEGORY_PRIORITY: Record<HideCategory, number> = {
  iban: 10,
  card: 9,
  email: 8,
  phone: 7,
  client: 6,
  project: 5,
  file: 5,
  term: 4,
  person: 3,
  amount: 2,
  redacted: 1,
};

/** Placeholders the model receives, e.g. [IBAN_1], [CLIENT_2]. */
export const PLACEHOLDER_PATTERN = /\[(IBAN|CARD|EMAIL|PHONE|AMOUNT|PERSON|CLIENT|PROJECT|FILE|TERM|REDACTED)_(\d{1,4})\]/g;

export function placeholderPrefix(category: HideCategory): string {
  return category.toUpperCase();
}

export function isHideMode(value: string): value is HideMode {
  return (HIDE_MODES as readonly string[]).includes(value);
}

export function isAutoCategory(value: string): value is AutoCategory {
  return (AUTO_CATEGORIES as readonly string[]).includes(value);
}

export type HideCounts = Partial<Record<HideCategory, number>>;

/** Company settings: default modes for new conversations and the categories Automatic masks. */
export type HideSettings = { defaultModes: HideMode[]; autoCategories: AutoCategory[] };

export function addCounts(a: HideCounts, b: HideCounts): HideCounts {
  const out: HideCounts = { ...a };
  for (const [k, v] of Object.entries(b) as [HideCategory, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
}

export function totalCount(counts: HideCounts | null | undefined): number {
  return Object.values(counts ?? {}).reduce((n, v) => n + (v ?? 0), 0);
}
