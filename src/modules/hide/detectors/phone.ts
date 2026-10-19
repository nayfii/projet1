import { findPhoneNumbersInText, type CountryCode } from "libphonenumber-js/max";
import type { Span } from "../categories";

// National formats are read as French, American and British numbers; international ones (+…) always.
const COUNTRIES: CountryCode[] = ["FR", "US", "GB"];

export function detectPhones(text: string): Span[] {
  const found = new Map<string, Span>();
  for (const country of COUNTRIES) {
    for (const m of findPhoneNumbersInText(text, country)) found.set(`${m.startsAt}:${m.endsAt}`, { start: m.startsAt, end: m.endsAt, category: "phone" });
  }
  return [...found.values()];
}
