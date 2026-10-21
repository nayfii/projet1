import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { GaugeIcon } from "lucide-react";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listMembers } from "@/modules/organizations/server/queries";
import { getCompanyModels } from "@/modules/providers/server/models";
import { getMemberCredits, getUsageSummary } from "@/modules/usage/server/queries";
import { getMyQuota } from "@/modules/usage/server/quota";
import { ShareList } from "@/modules/usage/ui/share-list";
import { Chart } from "@/modules/conversations/ui/chart";
import { PeriodSelect } from "@/modules/usage/ui/period-select";
import { ModelName } from "@/modules/conversations/ui/provider-mark";
import { Stat } from "@/modules/usage/ui/stat";
import { UsageTable } from "@/modules/usage/ui/usage-table";
import { daysOf, monthRange, recentMonths } from "@/modules/usage/period";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("usage") };
}

export default async function AdminUsagePage({ searchParams }: PageProps<"/admin/usage">) {
  const ctx = await requireScope("usage");
  const t = await getTranslations("usage");
  const format = await getFormatter();
  const { period } = await searchParams;
  // The current month and the 11 before.
  const months = recentMonths(12);
  const { key: selected, from, to, current } = monthRange(period, months);

  const [summary, members, models, memberCredits, quota] = await Promise.all([
    getUsageSummary(ctx.active.companyId, from, to),
    listMembers(ctx.active.companyId),
    getCompanyModels(ctx.active.companyId),
    current ? getMemberCredits(ctx.active.companyId) : Promise.resolve([]),
    current ? getMyQuota(ctx.active.companyId) : Promise.resolve(null),
  ]);
  const people = new Map(members.map((m) => [m.userId, m.fullName ?? m.email]));
  const limits = new Map(memberCredits.map((c) => [c.userId, c.limit]));
  const labels = new Map(models.catalog.map((m) => [m.id, m.label]));
  const n = (v: number) => format.number(v, { maximumFractionDigits: 0 });
  const credits = (v: number) => format.number(v, { maximumFractionDigits: v < 10 ? 1 : 0 });
  const usd = (v: number) => format.number(v, { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 4 : 2 });
  const share = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  const options = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return { value: m, label: format.dateTime(new Date(Date.UTC(y, mo - 1, 15)), { month: "long", year: "numeric", timeZone: "UTC" }) };
  });

  const totals = summary?.totals;
  const days = daysOf(from, to).map((day) => ({ day, credits: summary?.byDay.find((d) => d.day === day)?.credits ?? 0 }));
  const activeMembers = members.filter((m) => m.status === "active").length;
  const limit = quota?.status.companyLimit ?? 0;
  const known = new Set(["chat", "agent", "confronter", "embedding", "memory", "handover", "router"]);
  const empty = !summary || (summary.totals.requests === 0 && summary.video.renders === 0);

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} actions={<PeriodSelect value={selected} options={options} label={t("period")} />} />

      {empty || !totals ? (
        <EmptyState icon={<GaugeIcon />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t("aiCredits")}
              value={credits(totals.credits)}
              hint={current && limit > 0 ? t("ofLimit", { percent: share(totals.credits, limit), limit: n(limit) }) : undefined}
              meter={current && limit > 0 ? Math.min(totals.credits / limit, 1) : undefined}
            />
            <Stat label={t("aiRequests")} value={n(totals.requests)} hint={totals.errors ? t("errorsCount", { count: totals.errors }) : undefined} />
            <Stat label={t("activeUsers")} value={n(totals.active_users)} hint={t("activeUsersHint", { members: activeMembers })} />
            <Stat label={t("estimatedCost")} value={usd(totals.estimated_cost_usd)} hint={t("estimateLabel")} />
          </div>

          <Chart
            spec={{
              type: "bar",
              title: t("perDay"),
              labels: days.map((d) => String(Number(d.day.slice(8, 10)))),
              series: [{ name: t("credits"), values: days.map((d) => Math.round(d.credits * 10) / 10) }],
            }}
          />

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <h2 className="text-sm font-medium">{t("byFeature")}</h2>
              <Card className="overflow-hidden">
                <ShareList
                  rows={summary.byFeature.map((r) => ({
                    key: r.feature,
                    label: t(`features.${(known.has(r.feature) ? r.feature : "other") as "chat"}`),
                    value: r.credits,
                    figure: `${credits(r.credits)} · ${t("share", { percent: share(r.credits, totals.credits) })}`,
                  }))}
                />
              </Card>
            </div>
            <div className="space-y-3">
              <h2 className="text-sm font-medium">{t("byPerson")}</h2>
              <Card className="overflow-hidden">
                <ShareList
                  rows={summary.byUser.map((r) => {
                    const personal = r.user_id ? limits.get(r.user_id) : undefined;
                    return {
                      key: r.user_id ?? "deleted",
                      label: people.get(r.user_id ?? "") ?? t("formerMember"),
                      value: r.credits,
                      figure: `${credits(r.credits)} · ${t("share", { percent: share(r.credits, totals.credits) })}`,
                      hint: current ? (personal ? t("limitLabel", { limit: n(personal) }) : t("noLimit")) : undefined,
                    };
                  })}
                />
              </Card>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <UsageTable
                title={t("byModel")}
                headers={[t("colModel"), t("requests"), t("credits"), t("estimatedCostShort")]}
                rows={summary.byModel.map((r) => ({
                  key: r.model_id ?? "unknown",
                  cells: [
                    r.provider && r.model_id ? <ModelName key="m" provider={r.provider} label={labels.get(r.model_id) ?? r.model_id} /> : "—",
                    r.auto_requests ? t("requestsWithAuto", { count: n(r.requests), auto: n(r.auto_requests) }) : n(r.requests),
                    credits(r.credits),
                    usd(r.estimated_cost_usd),
                  ],
                }))}
              />
            </div>
            <div className="space-y-3">
              <h2 className="text-sm font-medium">{t("videoTitle")}</h2>
              <Card className="space-y-1.5 p-5">
                <p className="text-2xl font-semibold tracking-tight tabular-nums">{t("videoCredits", { credits: credits(summary.video.credits) })}</p>
                <p className="text-[13px] text-muted-foreground">{t("videoRenders", { renders: summary.video.renders, failed: summary.video.failed })}</p>
                <p className="pt-1 text-xs text-muted-foreground">{t("videoHint")}</p>
              </Card>
            </div>
          </section>

          <div className="space-y-1 text-[13px] text-muted-foreground">
            <p>{t("sourceNote")}</p>
            <p>{t("tokensNote", { input: n(totals.input_tokens), output: n(totals.output_tokens) })}</p>
            {totals.estimated_tokens_requests > 0 ? <p>{t("estimatedTokensNote", { count: totals.estimated_tokens_requests })}</p> : null}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
