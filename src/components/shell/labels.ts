import "server-only";
import { getTranslations } from "next-intl/server";
import type { ShellLabels } from "./app-shell";
import { APP_VERSION } from "@/lib/version";

export async function getShellLabels(): Promise<ShellLabels> {
  const t = await getTranslations("shell");
  return {
    comingSoon: t("comingSoon"),
    openMenu: t("openMenu"),
    navigation: t("navigation"),
    language: t("language"),
    signOut: t("signOut"),
    french: t("french"),
    english: t("english"),
    appearance: t("appearance"),
    themeDark: t("themeDark"),
    themeLight: t("themeLight"),
    themeSystem: t("themeSystem"),
    collapseSidebar: t("collapseSidebar"),
    expandSidebar: t("expandSidebar"),
    resizeSidebar: t("resizeSidebar"),
    version: t("version", { version: APP_VERSION }),
  };
}
