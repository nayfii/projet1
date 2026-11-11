import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TasksPage } from "@/modules/studio/ui/tasks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studio.nav");
  return { title: t("tasks") };
}

export default function Page() {
  return <TasksPage />;
}
