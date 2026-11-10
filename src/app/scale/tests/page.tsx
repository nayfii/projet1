import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TestsPage } from "@/modules/scale/ui/tests";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("tests") };
}

export default function Page() {
  return <TestsPage />;
}
