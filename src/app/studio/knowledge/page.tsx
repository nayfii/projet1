import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { KnowledgeHome } from "@/modules/studio/ui/knowledge";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studio.nav");
  return { title: t("knowledge") };
}

export default function Page() {
  return <KnowledgeHome />;
}
