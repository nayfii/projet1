import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DocEditor } from "@/modules/scale/ui/doc-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("strategy") };
}

export default async function Page({ params }: PageProps<"/scale/strategy/[id]">) {
  const { id } = await params;
  return <DocEditor id={id} />;
}
