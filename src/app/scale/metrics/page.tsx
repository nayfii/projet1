import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MetricsPage } from "@/modules/scale/ui/metrics";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("metrics") };
}

export default function Page() {
  return <MetricsPage />;
}
