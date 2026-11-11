import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DocumentEditor } from "@/modules/studio/ui/editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studio.nav");
  return { title: t("knowledge") };
}

export default async function Page({ params }: PageProps<"/studio/knowledge/[id]">) {
  const { id } = await params;
  // A new document reopens with an empty editor (the key resets it).
  return <DocumentEditor key={id} id={id} />;
}
