import "server-only";
import { getTranslations } from "next-intl/server";
import type { ShellLabels } from "./app-shell";

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
  };
}
