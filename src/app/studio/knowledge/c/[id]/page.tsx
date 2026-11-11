import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CategoryPage } from "@/modules/studio/ui/knowledge";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studio.nav");
  return { title: t("knowledge") };
}

export default async function Page({ params }: PageProps<"/studio/knowledge/c/[id]">) {
  const { id } = await params;
  return <CategoryPage id={id} />;
}
