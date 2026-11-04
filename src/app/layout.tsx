import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistMono } from "geist/font/mono";
import "@fontsource-variable/inter/opsz.css";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { AmbientBackground } from "@/components/shell/ambient-background";
import { AppearanceProvider } from "@/components/appearance/appearance-provider";
import { paletteStyles } from "@/lib/ambient/css";
import {
  AMBIENT_COOKIE,
  DEFAULT_AMBIENT,
  DEFAULT_MOTION,
  DEFAULT_THEME,
  MOTION_COOKIE,
  SCHEME_SCRIPT,
  SIDEBAR_COOKIE,
  THEME_COOKIE,
  isAmbient,
  isMotion,
  isTheme,
  resolveScheme,
  themeColor,
  type SidebarState,
} from "@/lib/theme";
import "./globals.css";

/** The device's appearance choices (cookies), applied on the server so the first paint is right. */
async function appearance() {
  const jar = await cookies();
  const theme = jar.get(THEME_COOKIE)?.value;
  const ambient = jar.get(AMBIENT_COOKIE)?.value;
  const motion = jar.get(MOTION_COOKIE)?.value;
  return {
    theme: isTheme(theme) ? theme : DEFAULT_THEME,
    ambient: isAmbient(ambient) ? ambient : DEFAULT_AMBIENT,
    motion: isMotion(motion) ? motion : DEFAULT_MOTION,
    sidebar: (jar.get(SIDEBAR_COOKIE)?.value === "collapsed" ? "collapsed" : "expanded") as SidebarState,
  };
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
  const { theme, ambient } = await appearance();
  if (theme !== "system") {
    const scheme = resolveScheme(theme, ambient);
    return { themeColor: themeColor(theme, ambient, scheme), colorScheme: scheme };
  }
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: themeColor(theme, ambient, "light") },
      { media: "(prefers-color-scheme: dark)", color: themeColor(theme, ambient, "dark") },
    ],
    colorScheme: "dark light",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const initial = await appearance();
  const { theme, ambient, motion, sidebar } = initial;
  return (
    // data-scheme is corrected before the first paint by SCHEME_SCRIPT when following the device.
    <html
      lang={locale}
      data-theme={theme}
      data-scheme={resolveScheme(theme, ambient)}
      data-ambient={ambient}
      data-motion={motion}
      data-sidebar={sidebar}
      className={`${GeistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCHEME_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: paletteStyles() }} />
      </head>
      <body className="min-h-full font-sans">
        <AmbientBackground />
        <NextIntlClientProvider>
          <AppearanceProvider initial={initial}>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster />
          </AppearanceProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
