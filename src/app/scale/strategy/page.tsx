import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StrategyPage } from "@/modules/scale/ui/strategy";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("strategy") };
}

export default function Page() {
  return <StrategyPage />;
}
