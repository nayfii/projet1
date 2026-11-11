import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RoadmapPage } from "@/modules/studio/ui/roadmap";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studio.nav");
  return { title: t("roadmap") };
}

export default function Page() {
  return <RoadmapPage />;
}
