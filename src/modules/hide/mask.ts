import { PLACEHOLDER_PATTERN, type AutoCategory, type HideCategory, type HideCounts, type HideMode, type Span } from "./categories";
import { mergeSpans } from "./spans";
import { escapeRegExp, fold, foldKey, originalRange } from "./normalize";

/** The person's choices for one message: active modes, and (Manual) values blurred or left visible. */
export type HideChoices = { modes: HideMode[]; blur: string[]; unblur: string[] };

/**
 * What is masked in a typed message:
 * - Automatic: detected passages of the categories the company masks, except those the person
 *   chose to leave visible (Manual).
 * - Manual: plus every passage the person blurred. A detected passage keeps its category; a free
 *   selection becomes "redacted".
 */
export function spansToMask(text: string, detected: Span[], autoCategories: ReadonlySet<AutoCategory>, choices: HideChoices): Span[] {
  const automatic = choices.modes.includes("automatic");
  const manual = choices.modes.includes("manual");
  const unblur = new Set(manual ? choices.unblur.map(foldKey) : []);
  const blur = manual ? choices.blur.map((b) => b.trim()).filter((b) => b.length > 0) : [];
  const blurKeys = new Set(blur.map(foldKey));
  const out: Span[] = [];
  for (const s of detected) {
    const key = foldKey(text.slice(s.start, s.end));
    if (blurKeys.has(key)) out.push(s);
    else if (automatic && s.category !== "redacted" && autoCategories.has(s.category) && !unblur.has(key)) out.push(s);
  }
  for (const value of blur) for (const range of findAll(text, value)) out.push({ ...range, category: "redacted" });
  return mergeSpans(out);
}

/** Documents mode (and memory passages): the categories the company masks, no manual choice. */
export function autoSpans(detected: Span[], autoCategories: ReadonlySet<AutoCategory>): Span[] {
  return detected.filter((s) => s.category !== "redacted" && autoCategories.has(s.category));
}

/** Every occurrence of `value` in `text`, ignoring accents, case and spacing. */
export function findAll(text: string, value: string): { start: number; end: number }[] {
  const key = foldKey(value);
  if (!key) return [];
  const f = fold(text);
  const pattern = new RegExp(escapeRegExp(key).replace(/ /g, "\\s+"), "gu");
  return [...f.folded.matchAll(pattern)].map((m) => originalRange(f, m.index, m.index + m[0].length));
}

/** The form of a value used to give it a stable placeholder ("FR76 3000…" and "FR763000…" are one IBAN). */
export function canonicalValue(category: HideCategory, value: string): string {
  switch (category) {
    case "iban":
      return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    case "card":
    case "phone":
      return value.replace(/\D/g, "");
    case "email":
      return value.trim().toLowerCase();
    default:
      return foldKey(value);
  }
}

/** Replaces each span by its placeholder. `placeholderOf` returns the placeholder of a (category, value). */
export function applyPlaceholders(
  text: string,
  spans: Span[],
  placeholderOf: (category: HideCategory, value: string) => string,
): { masked: string; counts: HideCounts } {
  const counts: HideCounts = {};
  let masked = "";
  let cursor = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < cursor) continue;
    masked += text.slice(cursor, s.start) + placeholderOf(s.category, text.slice(s.start, s.end));
    counts[s.category] = (counts[s.category] ?? 0) + 1;
    cursor = s.end;
  }
  return { masked: masked + text.slice(cursor), counts };
}

/** Puts the real values back in place of known placeholders; unknown ones are left as written. */
export function restorePlaceholders(text: string, values: ReadonlyMap<string, string>): string {
  if (values.size === 0) return text;
  return text.replace(PLACEHOLDER_PATTERN, (placeholder) => values.get(placeholder) ?? placeholder);
}

/**
 * Restores placeholders in a streamed answer. A placeholder can arrive in pieces ("[CLI" then
 * "ENT_1]"): a possible beginning is held back until it is complete.
 */
export class StreamRestorer {
  private buffer = "";

  constructor(private readonly values: ReadonlyMap<string, string>) {}

  push(delta: string): string {
    this.buffer += delta;
    const open = this.buffer.lastIndexOf("[");
    let cut = this.buffer.length;
    if (open !== -1 && this.buffer.length - open <= 16 && /^\[[A-Z]*_?\d*$/.test(this.buffer.slice(open))) cut = open;
    const out = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);
    return restorePlaceholders(out, this.values);
  }

  flush(): string {
    const out = restorePlaceholders(this.buffer, this.values);
    this.buffer = "";
    return out;
  }
}
