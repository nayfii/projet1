import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { GaugeIcon } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getPlatformSettings, getUsageOverview } from "@/modules/platform/server/queries";
import { companyMargin, convert, totalInEur, type Currency } from "@/modules/platform/margin";
import { ExchangeRateForm } from "@/modules/platform/ui/exchange-rate-form";
import { PeriodSelect } from "@/modules/usage/ui/period-select";
import { Stat } from "@/modules/usage/ui/stat";
import { UsageTable } from "@/modules/usage/ui/usage-table";
import { monthRange, recentMonths } from "@/modules/usage/period";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("usage") };
}

/** Usage and margins per company (CLAUDE.md §4.9). Totals only: no person, no content. */
export default async function PlatformUsagePage({ searchParams }: PageProps<"/platform/usage">) {
  await requirePlatformAdmin();
  const t = await getTranslations("platformUsage");
  const format = await getFormatter();
  const months = recentMonths(12);
  const { key: selected, from, to, current } = monthRange((await searchParams).period, months);
  const [rows, settings] = await Promise.all([getUsageOverview(from, to), getPlatformSettings()]);
  const rate = settings.usdToEur;

  const money = (v: number, currency: Currency) => format.number(v, { style: "currency", currency, maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 });
  const usd = (v: number) => format.number(v, { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 4 : 2 });
  const n = (v: number) => format.number(v, { maximumFractionDigits: 0 });
  const pct = (v: number) => format.number(v, { style: "percent", maximumFractionDigits: 0 });
  const options = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return { value: m, label: format.dateTime(new Date(Date.UTC(y, mo - 1, 15)), { month: "long", year: "numeric", timeZone: "UTC" }) };
  });

  const companies = rows
    .map((r) => ({ ...r, margin: companyMargin({ seats: r.seats, pricePerSeat: r.pricePerSeat, currency: r.currency, costUsd: r.costUsd, usdToEur: rate }) }))
    .sort((a, b) => b.costUsd - a.costUsd || a.name.localeCompare(b.name));
  const totals = totalInEur(
    companies.map((c) => c.margin),
    rate,
  );
  const costUsd = companies.reduce((s, c) => s + c.costUsd, 0);
  const videoCredits = companies.reduce((s, c) => s + c.videoCredits, 0);
  const renders = companies.reduce((s, c) => s + c.renders, 0);
  const unpriced = companies.filter((c) => c.pricePerSeat === null && c.status === "active").length;
  const marginRate = totals.margin !== null && totals.revenue ? totals.margin / totals.revenue : null;
  const costEur = convert(costUsd, "USD", "EUR", rate);

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader title={t("title")} description={t("description")} actions={<PeriodSelect value={selected} options={options} label={t("period")} />} />

      {companies.length === 0 ? (
        <EmptyState icon={<GaugeIcon />} title={t("emptyTitle")} />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t("revenue")}
              value={totals.revenue === null ? "—" : money(totals.revenue, "EUR")}
              hint={unpriced ? t("unpriced", { count: unpriced }) : t("revenueHint")}
            />
            <Stat label={t("aiCost")} value={usd(costUsd)} hint={costEur === null ? t("estimate") : t("aiCostEur", { eur: money(costEur, "EUR") })} />
            <Stat
              label={t("margin")}
              value={totals.margin === null ? "—" : money(totals.margin, "EUR")}
              hint={totals.margin === null ? t("marginNeedsRate") : marginRate === null ? t("estimate") : t("marginRate", { rate: pct(marginRate) })}
              tone={totals.margin !== null && totals.margin < 0 ? "danger" : undefined}
            />
            <Stat label={t("video")} value={n(videoCredits)} hint={t("videoHint", { renders })} />
          </div>

          <UsageTable
            headers={[t("colCompany"), t("colSeats"), t("colRequests"), t("colCredits"), t("colVideo"), t("colCost"), t("colRevenue"), t("colMargin")]}
            rows={companies.map((c) => ({
              key: c.companyId,
              cells: [
                <span key="name" className="flex min-w-0 flex-col">
                  <Link href={`/platform/companies/${c.companyId}?period=${selected}`} className="truncate font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {c.planName ?? t("noPlan")}
                    {c.status === "suspended" ? <Badge variant="outline">{t("suspended")}</Badge> : null}
                  </span>
                </span>,
                n(c.seats),
                c.errors ? t("requestsWithErrors", { requests: n(c.requests), errors: n(c.errors) }) : n(c.requests),
                n(c.credits),
                n(c.videoCredits),
                usd(c.costUsd),
                c.margin.revenue === null ? <span className="text-muted-foreground">{t("noPrice")}</span> : money(c.margin.revenue, c.currency),
                c.margin.margin === null ? (
                  "—"
                ) : (
                  <span key="m" className={c.margin.margin < 0 ? "font-medium text-destructive" : undefined}>
                    {money(c.margin.margin, c.currency)}
                    {c.margin.rate !== null ? <span className="ml-1.5 text-xs text-muted-foreground">{pct(c.margin.rate)}</span> : null}
                  </span>
                ),
              ],
            }))}
          />

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <Card className="p-5">
              <ExchangeRateForm usdToEur={rate} />
            </Card>
            <div className="space-y-1.5 text-[13px] text-muted-foreground">
              <p>{t("noteCost")}</p>
              <p>{t("noteRevenue")}</p>
              {current ? <p>{t("noteCurrent")}</p> : null}
              <p>{t("notePrivacy")}</p>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
