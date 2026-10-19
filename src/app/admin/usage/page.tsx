import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { GaugeIcon } from "lucide-react";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listMembers } from "@/modules/organizations/server/queries";
import { getCompanyModels } from "@/modules/providers/server/models";
import { getUsageSummary } from "@/modules/usage/server/queries";
import { PeriodSelect } from "@/modules/usage/ui/period-select";
import { ModelName } from "@/modules/conversations/ui/provider-mark";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("usage") };
}

/** Months offered in the period picker: the current one and the 11 before (UTC, like credits). */
function monthOptions(now = new Date()) {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default async function AdminUsagePage({ searchParams }: PageProps<"/admin/usage">) {
  const ctx = await requireScope("usage");
  const t = await getTranslations("usage");
  const format = await getFormatter();
  const { period } = await searchParams;
  const months = monthOptions();
  const selected = typeof period === "string" && months.includes(period) ? period : months[0];
  const [year, month] = selected.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  const [summary, members, models] = await Promise.all([
    getUsageSummary(ctx.active.companyId, from, to),
    listMembers(ctx.active.companyId),
    getCompanyModels(ctx.active.companyId),
  ]);
  const people = new Map(members.map((m) => [m.userId, m.fullName ?? m.email]));
  const labels = new Map(models.catalog.map((m) => [m.id, m.label]));
  const n = (v: number) => format.number(v, { maximumFractionDigits: 0 });
  const credits = (v: number) => format.number(v, { maximumFractionDigits: v < 10 ? 1 : 0 });
  const usd = (v: number) => format.number(v, { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 4 : 2 });

  const options = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return { value: m, label: format.dateTime(new Date(Date.UTC(y, mo - 1, 15)), { month: "long", year: "numeric", timeZone: "UTC" }) };
  });

  const totals = summary?.totals;
  const days = Array.from({ length: Math.round((to.getTime() - from.getTime()) / 86_400_000) }, (_, i) => {
    const day = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { day, credits: summary?.byDay.find((d) => d.day === day)?.credits ?? 0 };
  });
  const maxDay = Math.max(...days.map((d) => d.credits), 0);

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} actions={<PeriodSelect value={selected} options={options} label={t("period")} />} />

      {!totals || totals.requests === 0 ? (
        <EmptyState icon={<GaugeIcon />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("requests")} value={n(totals.requests)} hint={totals.errors ? t("errorsCount", { count: totals.errors }) : undefined} />
            <Stat label={t("credits")} value={credits(totals.credits)} />
            <Stat label={t("tokens")} value={n(totals.input_tokens + totals.output_tokens)} hint={t("tokensSplit", { input: n(totals.input_tokens), output: n(totals.output_tokens) })} />
            <Stat label={t("estimatedCost")} value={usd(totals.estimated_cost_usd)} hint={t("estimateLabel")} />
          </div>

          <Card className="p-5">
            <p className="mb-4 text-sm font-medium">{t("perDay")}</p>
            <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={t("perDay")}>
              {days.map((d) => (
                <div
                  key={d.day}
                  title={`${format.dateTime(new Date(d.day + "T12:00:00Z"), { dateStyle: "medium", timeZone: "UTC" })} · ${credits(d.credits)}`}
                  className="flex-1 rounded-t-sm bg-brand/70 transition-colors hover:bg-brand"
                  style={{ height: maxDay ? `${Math.max((d.credits / maxDay) * 100, d.credits ? 3 : 1)}%` : "1%", opacity: d.credits ? 1 : 0.25 }}
                />
              ))}
            </div>
          </Card>

          <section className="grid gap-6 lg:grid-cols-2">
            <UsageTable
              title={t("byPerson")}
              headers={[t("colPerson"), t("requests"), t("credits"), t("estimatedCostShort")]}
              rows={summary.byUser.map((r) => ({
                key: r.user_id ?? "deleted",
                cells: [people.get(r.user_id ?? "") ?? t("formerMember"), n(r.requests), credits(r.credits), usd(r.estimated_cost_usd)],
              }))}
            />
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
          </section>

          <div className="space-y-1 text-[13px] text-muted-foreground">
            <p>{t("sourceNote")}</p>
            {totals.estimated_tokens_requests > 0 ? <p>{t("estimatedTokensNote", { count: totals.estimated_tokens_requests })}</p> : null}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

function UsageTable({ title, headers, rows }: { title: string; headers: string[]; rows: { key: string; cells: React.ReactNode[] }[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[13px] text-muted-foreground">
              {headers.map((h, i) => (
                <th key={h} className={i === 0 ? "px-4 py-2.5 font-medium" : "px-4 py-2.5 text-right font-medium"}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key}>
                {r.cells.map((c, i) => (
                  <td key={i} className={i === 0 ? "max-w-48 truncate px-4 py-2.5" : "px-4 py-2.5 text-right tabular-nums"}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
