import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistMono } from "geist/font/mono";
import "@fontsource-variable/inter/opsz.css";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { DEFAULT_THEME, THEME_COLORS, THEME_COOKIE, isTheme, type Theme } from "@/lib/theme";
import "./globals.css";

async function currentTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: t("productName"), template: `%s · ${t("productName")}` },
    description: t("tagline"),
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const theme = await currentTheme();
  if (theme !== "system") return { themeColor: THEME_COLORS[theme], colorScheme: theme };
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
    ],
    colorScheme: "dark light",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const theme = await currentTheme();
  return (
    <html lang={locale} data-theme={theme} className={`${GeistMono.variable} h-full`}>
      <body className="min-h-full font-sans">
        <NextIntlClientProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
