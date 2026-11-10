import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProjectsPage } from "@/modules/scale/ui/projects";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("projects") };
}

export default function Page() {
  return <ProjectsPage />;
}
