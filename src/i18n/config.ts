export const locales = ["fr", "en"] as const;
export type Locale = (typeof locales)[number];

export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export const defaultLocale: Locale = isLocale(process.env.NEXT_PUBLIC_DEFAULT_LOCALE)
  ? process.env.NEXT_PUBLIC_DEFAULT_LOCALE
  : "fr";

/** Picks fr or en from an Accept-Language header, by order of preference. */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) {
    if (isLocale(lang)) return lang;
  }
  return null;
}
