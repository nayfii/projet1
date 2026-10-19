import type { Span } from "../categories";

/**
 * Deterministic detectors with checksums where they exist: IBAN (mod 97), card numbers (Luhn),
 * emails, amounts in French and English formats. Recall is imperfect by nature.
 */

// IBAN length per country (ISO 13616 registry).
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};

export function ibanChecksumValid(iban: string): boolean {
  const compact = iban.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

export function detectIbans(text: string): Span[] {
  const spans: Span[] = [];
  const candidate = /(?<![A-Za-z0-9])([A-Za-z]{2})\d{2}(?:[  -]?[A-Za-z0-9]){10,32}/g;
  let m: RegExpExecArray | null;
  while ((m = candidate.exec(text))) {
    const country = m[1].toUpperCase();
    const expected = IBAN_LENGTHS[country];
    const lengths = expected ? [expected] : Array.from({ length: 20 }, (_, i) => 34 - i);
    let found = false;
    for (const length of lengths) {
      // Take the first `length` letters/digits of the candidate (separators allowed in between).
      let count = 0;
      let end = m.index;
      for (; end < m.index + m[0].length && count < length; end++) if (/[A-Za-z0-9]/.test(text[end])) count++;
      if (count === length && ibanChecksumValid(text.slice(m.index, end))) {
        spans.push({ start: m.index, end, category: "iban" });
        // The candidate may have run into a following IBAN: continue right after this one.
        candidate.lastIndex = end;
        found = true;
        break;
      }
    }
    if (!found) candidate.lastIndex = m.index + 1;
  }
  return spans;
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Visa, Mastercard, Amex, Diners, JCB, Discover, CB/Maestro ranges.
const CARD_PREFIX = /^(4|5[0-8]|2[2-7]|3[47]|3[068]|35|6(011|5|4[4-9]|22|7))/;

export function detectCards(text: string): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(/(?<!\d|\d[.,])(?:\d[ -]?){12,18}\d(?!\d|[.,]\d)/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && CARD_PREFIX.test(digits) && luhnValid(digits)) {
      spans.push({ start: m.index, end: m.index + m[0].length, category: "card" });
    }
  }
  return spans;
}

export function detectEmails(text: string): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(/(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
    spans.push({ start: m.index, end: m.index + m[0].length, category: "email" });
  }
  return spans;
}

const NUMBER = String.raw`(?:\d{1,3}(?:[   .,']\d{3})+|\d+)(?:[.,]\d{1,2})?`;
const MULTIPLIER = String.raw`(?:k|K|m|M|Md|Mds|md|mds|bn|Bn|millions?|milliards?|billions?|mille)`;
const SYMBOL_BEFORE = String.raw`(?:US\$|\$|€|£|EUR|USD|GBP|CHF)`;
const CURRENCY_AFTER = String.raw`(?:€|\$|£|EUR|USD|GBP|CHF|euros?|dollars?|livres?(?: sterling)?|francs?(?: suisses?)?)`;
const AMOUNT = new RegExp(
  [
    // €1,250.50 · $3.5M · EUR 900
    String.raw`${SYMBOL_BEFORE}[  ]?${NUMBER}(?:[  ]?${MULTIPLIER}(?![\p{L}]))?`,
    // 1 250,50 € · 3 500 euros · 12 k€ · 1,5 M€ · 2 millions d'euros
    String.raw`${NUMBER}(?:[  ]?${MULTIPLIER})?[  ]?(?:d'|d’|de )?${CURRENCY_AFTER}(?![\p{L}])`,
  ].join("|"),
  "gu",
);

export function detectAmounts(text: string): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    // Not in the middle of a longer number or word.
    const before = text[m.index - 1];
    if (before && /[\p{L}\d]/u.test(before)) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, category: "amount" });
  }
  return spans;
}
