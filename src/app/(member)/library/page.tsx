import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LibraryIcon, WandSparklesIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ComingSoon } from "@/components/ui/coming-soon";
import { DEPARTMENTS, LAUNCH_AGENTS } from "@/modules/agents/definitions";
import { listLibrary } from "@/modules/agents/server/queries";
import { AgentBadges } from "@/modules/agents/ui/agent-badges";
import { agentText, type DynamicT } from "@/modules/agents/labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tools");
  return { title: t("libraryTitle") };
}

/** The library by department (CLAUDE.md §4.7): company tools and agents, and the launch agents to come. */
export default async function LibraryPage() {
  const ctx = await requireMember();
  const t = await getTranslations("tools");
  // Shown: what the person may run, and their own tools whatever their state.
  const all = await listLibrary(ctx);
  const items = all.filter((a) => a.usable || a.mine);
  // Built-in agents present in the database (and so runnable); the others are still to come.
  const built = new Set(all.map((a) => a.builtinKey));
  const text = (a: (typeof items)[number]) => agentText(a, t as unknown as DynamicT);

  return (
    <PageContainer>
      <PageHeader title={t("libraryTitle")} description={t("libraryDescription")} />
      <p className="mb-8 flex items-start gap-2 rounded-xl border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        <WandSparklesIcon className="mt-0.5 size-4 shrink-0 text-brand" />
        {t("howToCreate")}
      </p>
      <div className="space-y-10">
        {DEPARTMENTS.map((department) => {
          const own = items.filter((a) => a.department === department);
          const upcoming = LAUNCH_AGENTS.filter((a) => a.department === department && !built.has(a.key));
          if (own.length === 0 && upcoming.length === 0) return null;
          return (
            <section key={department} aria-labelledby={`dept-${department}`} className="space-y-3">
              <h2 id={`dept-${department}`} className="text-sm font-medium">
                {t(`departments.${department}`)}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {own.map((a) => (
                  <Link key={a.id} href={`/library/${a.id}`} className="rounded-xl">
                    <Card className="h-full space-y-2 p-4 transition-colors hover:border-foreground/20">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{text(a).name}</p>
                        <AgentBadges agent={a} />
                      </div>
                      {text(a).description ? <p className="line-clamp-2 text-[13px] text-muted-foreground">{text(a).description}</p> : null}
                      {!a.mine && a.creatorName ? <p className="text-xs text-muted-foreground">{t("by", { name: a.creatorName })}</p> : null}
                    </Card>
                  </Link>
                ))}
                {upcoming.map((a) => (
                  <Card key={a.key} className="h-full space-y-2 border-dashed p-4 opacity-75" aria-disabled>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{t(`launch.${a.key}.name`)}</p>
                      <ComingSoon />
                    </div>
                    <p className="line-clamp-2 text-[13px] text-muted-foreground">{t(`launch.${a.key}.description`)}</p>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <LibraryIcon className="size-4" />
            {t("emptyCompany")}
          </p>
        ) : null}
      </div>
    </PageContainer>
  );
}
