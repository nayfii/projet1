import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from "./config";

/** Locale order: the user's choice (cookie, synced from their profile) → browser language → default. */
export async function resolveLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  return localeFromAcceptLanguage((await headers()).get("accept-language")) ?? defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    timeZone: "Europe/Paris",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
