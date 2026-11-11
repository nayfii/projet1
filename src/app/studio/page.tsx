import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OverviewPage } from "@/modules/studio/ui/overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studio.nav");
  return { title: t("overview") };
}

export default function Page() {
  return <OverviewPage />;
}
