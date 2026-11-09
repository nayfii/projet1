import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ArchivePage } from "@/modules/scale/ui/archive-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("archive") };
}

export default function Page() {
  return <ArchivePage />;
}
