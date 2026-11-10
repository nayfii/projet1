import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TestPage } from "@/modules/scale/ui/test-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("tests") };
}

export default async function Page({ params }: PageProps<"/scale/tests/[id]">) {
  const { id } = await params;
  return <TestPage id={id} />;
}
