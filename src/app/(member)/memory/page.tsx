import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowRightIcon, BriefcaseIcon, BuildingIcon, KeyRoundIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listMemorySpaces } from "@/modules/memory/server/queries";
import { consciousnessOverview } from "@/modules/memory/server/knowledge";
import { AccessRequestQueue, MyAccessRequests, ProposalQueue } from "@/modules/memory/ui/consciousness-queues";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory");
  return { title: t("title") };
}

/**
 * Consciousness: where the company's knowledge is understood and governed (people work in Clients
 * and chats). Real counts, what waits for this person, recent learning, the memories they can read.
 */
export default async function MemoryPage() {
  const ctx = await requireMember();
  const [t, tc, format, spaces, overview] = await Promise.all([
    getTranslations("memory"),
    getTranslations("consciousness.hub"),
    getFormatter(),
    listMemorySpaces(ctx),
    consciousnessOverview(ctx),
  ]);
  const company = spaces.find((s) => s.kind === "company");
  const clients = spaces.filter((s) => s.kind === "client" && !s.clientArchived);
  const governance = hasScope(ctx.active, "permissions") || hasScope(ctx.active, "models");
  const stats = [
    { label: tc("statFacts"), value: overview.stats.facts },
    { label: tc("statLearned"), value: overview.stats.learnedThisWeek },
    { label: tc("statClients"), value: overview.stats.clients },
    { label: tc("statDocuments"), value: overview.stats.documents },
  ];

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="consciousness-stats">
        {stats.map((s) => (
          <Card key={s.label} className="px-4 py-3">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>

      {overview.proposals.length > 0 || overview.toDecide.length > 0 ? (
        <div className="mb-8 space-y-6">
          {overview.proposals.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="text-sm font-medium">{tc("toConfirm")}</h2>
              <ProposalQueue proposals={overview.proposals} />
            </section>
          ) : null}
          {overview.toDecide.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <KeyRoundIcon className="size-4 text-muted-foreground" />
                {tc("accessRequests")}
              </h2>
              <AccessRequestQueue requests={overview.toDecide} />
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-8">
          {company ? (
            <Link href={`/memory/${company.spaceId}`} className="group block rounded-xl">
              <Card className="flex items-center gap-4 p-5 transition-colors group-hover:border-foreground/20">
                <div className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <BuildingIcon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t("companyMemory")}</p>
                  <p className="text-sm text-muted-foreground">{t("companyMemoryBody")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("counts", { entries: company.entryCount, documents: company.documentCount })}</p>
                </div>
                {!company.canWrite ? <Badge variant="outline">{t("readOnly")}</Badge> : null}
                <ArrowRightIcon className="size-4 text-muted-foreground" />
              </Card>
            </Link>
          ) : null}

          <section>
            <h2 className="mb-3 text-sm font-medium">{t("clientMemories")}</h2>
            {clients.length === 0 ? (
              <EmptyState icon={<BriefcaseIcon />} title={t("noClientMemories")} description={t("noClientMemoriesBody")} />
            ) : (
              <Card className="divide-y overflow-hidden">
                {clients.map((s) => (
                  <Link key={s.spaceId} href={`/memory/${s.spaceId}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60">
                    <BriefcaseIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.clientName}</span>
                      <span className="block text-xs text-muted-foreground">{t("counts", { entries: s.entryCount, documents: s.documentCount })}</span>
                    </span>
                    {s.blockedProviders.length > 0 ? <Badge variant="outline">{tc("restrictedModels")}</Badge> : null}
                    {!s.canWrite ? <Badge variant="outline">{t("readOnly")}</Badge> : null}
                    <ArrowRightIcon className="size-4 text-muted-foreground" />
                  </Link>
                ))}
              </Card>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="space-y-2.5">
            <h2 className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
              <SparklesIcon className="size-4" />
              {tc("activity")}
            </h2>
            {overview.activity.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{tc("noActivity")}</p>
            ) : (
              <ul className="space-y-3" data-testid="consciousness-activity">
                {overview.activity.map((a) => (
                  <li key={a.id} className="text-[13px] leading-snug">
                    <Link href={a.where.kind === "client" ? `/memory/${a.where.spaceId}` : `/memory/${a.where.spaceId}`} className="hover:underline">
                      <span className={a.status === "superseded" ? "text-muted-foreground line-through" : undefined}>{a.title}</span>
                    </Link>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      {a.where.kind === "company" ? t("companyMemory") : a.where.clientName} · {tc(`origin.${a.sourceType as "auto"}`)} ·{" "}
                      {format.relativeTime(new Date(a.at))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {overview.mine.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-[13px] font-medium text-muted-foreground">{tc("myRequests")}</h2>
              <MyAccessRequests requests={overview.mine} />
            </section>
          ) : null}
          {governance ? (
            <section className="space-y-2">
              <h2 className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <SettingsIcon className="size-4" />
                {tc("governance")}
              </h2>
              <ul className="space-y-1 text-[13px]">
                <li>
                  <Link href="/admin/permissions" className="text-muted-foreground hover:text-foreground">
                    {tc("governancePermissions")}
                  </Link>
                </li>
                <li>
                  <Link href="/admin/models" className="text-muted-foreground hover:text-foreground">
                    {tc("governanceLearning")}
                  </Link>
                </li>
                <li>
                  <Link href="/admin/activity" className="text-muted-foreground hover:text-foreground">
                    {tc("governanceActivity")}
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}
