import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeftIcon, GaugeIcon } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getCompanyUsageForPlatform, getPlatformSettings, getUsageOverview, listCompaniesForPlatform } from "@/modules/platform/server/queries";
import { companyMargin } from "@/modules/platform/margin";
import { Chart } from "@/modules/conversations/ui/chart";
import { ModelName } from "@/modules/conversations/ui/provider-mark";
import type { ProviderId } from "@/modules/providers/types";
import { PeriodSelect } from "@/modules/usage/ui/period-select";
import { ShareList } from "@/modules/usage/ui/share-list";
import { Stat } from "@/modules/usage/ui/stat";
import { UsageTable } from "@/modules/usage/ui/usage-table";
import { daysOf, monthRange, recentMonths } from "@/modules/usage/period";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("usage") };
}

const FEATURES = new Set(["chat", "agent", "confronter", "embedding", "memory", "handover", "router"]);

/** One company's usage for our team: per day, model and feature. Never per person, never content. */
export default async function PlatformCompanyPage({ params, searchParams }: PageProps<"/platform/companies/[id]">) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("platformUsage");
  const tUsage = await getTranslations("usage");
  const format = await getFormatter();
  const months = recentMonths(12);
  const { key: selected, from, to } = monthRange((await searchParams).period, months);
  const supabase = await createClient();

  const [companies, usage, overview, settings, { data: models }] = await Promise.all([
    listCompaniesForPlatform(),
    getCompanyUsageForPlatform(id, from, to),
    getUsageOverview(from, to),
    getPlatformSettings(),
    supabase.from("ai_models").select("id, label"),
  ]);
  const company = companies.find((c) => c.id === id);
  const row = overview.find((r) => r.companyId === id);
  if (!company || !usage || !row) notFound();

  const labels = new Map((models ?? []).map((m) => [m.id, m.label]));
  const margin = companyMargin({ seats: row.seats, pricePerSeat: row.pricePerSeat, currency: row.currency, costUsd: row.costUsd, usdToEur: settings.usdToEur });
  const money = (v: number) => format.number(v, { style: "currency", currency: row.currency, maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 });
  const usd = (v: number) => format.number(v, { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 4 : 2 });
  const n = (v: number) => format.number(v, { maximumFractionDigits: 0 });
  const share = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const options = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return { value: m, label: format.dateTime(new Date(Date.UTC(y, mo - 1, 15)), { month: "long", year: "numeric", timeZone: "UTC" }) };
  });
  const days = daysOf(from, to).map((day) => ({ day, cost: usage.byDay.find((d) => d.day === day)?.estimated_cost_usd ?? 0 }));
  const empty = usage.totals.requests === 0 && usage.video.renders === 0;

  return (
    <PageContainer className="max-w-6xl">
      <Link href={`/platform/usage?period=${selected}`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" />
        {t("back")}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {company.name}
            {company.status === "suspended" ? <Badge variant="outline">{t("suspended")}</Badge> : null}
          </span>
        }
        description={t("companyDescription", {
          plan: company.plan_name ?? t("noPlan"),
          seats: row.seats,
          owner: company.owner_email ?? "—",
        })}
        actions={<PeriodSelect value={selected} options={options} label={t("period")} />}
      />

      {empty ? (
        <EmptyState icon={<GaugeIcon />} title={t("companyEmpty")} />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t("colRequests")}
              value={n(usage.totals.requests)}
              hint={t("companyPeople", { people: usage.totals.activeUsers, errors: usage.totals.errors })}
            />
            <Stat label={t("colCredits")} value={n(usage.totals.credits)} hint={t("videoLine", { credits: n(usage.video.credits), renders: usage.video.renders })} />
            <Stat label={t("aiCost")} value={usd(usage.totals.costUsd)} hint={t("estimate")} />
            <Stat
              label={t("margin")}
              value={margin.margin === null ? "—" : money(margin.margin)}
              hint={
                margin.revenue === null
                  ? t("noPrice")
                  : margin.margin === null
                    ? t("marginNeedsRate")
                    : t("marginOf", { revenue: money(margin.revenue), rate: margin.rate === null ? "—" : format.number(margin.rate, { style: "percent" }) })
              }
              tone={margin.margin !== null && margin.margin < 0 ? "danger" : undefined}
            />
          </div>

          <Chart
            spec={{
              type: "bar",
              title: t("costPerDay"),
              unit: "$",
              labels: days.map((d) => String(Number(d.day.slice(8, 10)))),
              series: [{ name: t("aiCost"), values: days.map((d) => Math.round(d.cost * 10000) / 10000) }],
            }}
          />

          <section className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <UsageTable
                title={tUsage("byModel")}
                headers={[tUsage("colModel"), t("colRequests"), t("colCredits"), t("colCost")]}
                rows={usage.byModel.map((r) => ({
                  key: r.model_id ?? "unknown",
                  cells: [
                    r.provider && r.model_id ? <ModelName key="m" provider={r.provider as ProviderId} label={labels.get(r.model_id) ?? r.model_id} /> : "—",
                    n(r.requests),
                    n(r.credits),
                    usd(r.estimated_cost_usd),
                  ],
                }))}
              />
            </div>
            <div className="space-y-3 lg:col-span-2">
              <h2 className="text-sm font-medium">{tUsage("byFeature")}</h2>
              <Card className="overflow-hidden">
                <ShareList
                  rows={usage.byFeature.map((r) => ({
                    key: r.feature,
                    label: tUsage(`features.${(FEATURES.has(r.feature) ? r.feature : "other") as "chat"}`),
                    value: r.estimated_cost_usd,
                    figure: `${usd(r.estimated_cost_usd)} · ${tUsage("share", { percent: share(r.estimated_cost_usd, usage.totals.costUsd) })}`,
                  }))}
                />
              </Card>
            </div>
          </section>

          <p className="text-[13px] text-muted-foreground">{t("companyPrivacy")}</p>
        </div>
      )}
    </PageContainer>
  );
}
