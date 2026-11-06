import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { DEPARTMENTS } from "@/modules/agents/definitions";
import { listFavoriteApps, listLibrary, popularApps, recentApps } from "@/modules/agents/server/queries";
import { agentText, type DynamicT } from "@/modules/agents/labels";
import { AppsBrowser } from "@/modules/agents/ui/apps-browser";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("apps");
  return { title: t("title") };
}

/** Applis (CLAUDE.md §11, replaces the Library): our apps, the company's own tools, each person's favourites. */
export default async function AppsPage({ searchParams }: PageProps<"/apps">) {
  const ctx = await requireMember();
  const t = await getTranslations("apps");
  const tTools = await getTranslations("tools");
  const [all, favorites, uses, recent] = await Promise.all([listLibrary(ctx), listFavoriteApps(ctx), popularApps(ctx), recentApps(ctx)]);
  // Shown: what the person may run, the apps coming soon, and their own tools whatever their state.
  const apps = all
    .filter((a) => a.usable || a.mine || a.availability === "soon")
    .map((a) => {
      const text = agentText(a, tTools as unknown as DynamicT);
      return {
        id: a.id,
        name: text.name,
        description: text.description,
        department: a.department,
        favorite: favorites.has(a.id),
        uses: uses.get(a.id) ?? 0,
        soon: a.availability === "soon",
        byTeam: !a.builtin,
        usable: a.usable,
      };
    })
    .sort((a, b) => Number(a.soon) - Number(b.soon) || a.name.localeCompare(b.name));
  const present = new Set(apps.map((a) => a.department));
  const departments = DEPARTMENTS.filter((d) => present.has(d)).map((d) => ({ key: d, label: tTools(`departments.${d}`) }));
  void searchParams;

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title={t("title")} description={t("description")} />
      <AppsBrowser apps={apps} departments={departments} recent={recent} />
    </PageContainer>
  );
}
