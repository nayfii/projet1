import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Overview } from "@/modules/scale/ui/overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("overview") };
}

export default function ScaleOverviewPage() {
  return <Overview />;
}
