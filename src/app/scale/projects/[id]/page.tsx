import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProjectPage } from "@/modules/scale/ui/project-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.nav");
  return { title: t("projects") };
}

export default async function Page({ params }: PageProps<"/scale/projects/[id]">) {
  const { id } = await params;
  return <ProjectPage id={id} />;
}
