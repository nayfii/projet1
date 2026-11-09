import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Roadmap } from "@/modules/scale/ui/roadmap";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("roadmap") };
}

export default function Page() {
  return <Roadmap />;
}
