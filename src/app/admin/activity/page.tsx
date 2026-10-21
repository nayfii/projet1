import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActivityIcon } from "lucide-react";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTIVITY_PAGE_SIZE, listCompanyActivity } from "@/modules/audit/server/queries";
import { ACTIVITY_PERIODS, isActivityCategory, type ActivityPeriod } from "@/modules/audit/categories";
import { ActivityFilters } from "@/modules/audit/ui/activity-filters";
import { listMembers } from "@/modules/organizations/server/queries";
import { listClients } from "@/modules/clients/server/queries";
import { describeEvent } from "@/modules/audit/describe";
import { AUTO_CATEGORIES, type HideCategory } from "@/modules/hide/categories";

const HIDE_CATEGORY_KEYS: string[] = [...AUTO_CATEGORIES, "redacted"];

/** The same filters, one page further back (`before`) or back to the latest (null). */
function pageHref(params: Record<string, string | string[] | undefined>, before: string | null) {
  const next = new URLSearchParams();
  for (const key of ["category", "person", "period"]) {
    const value = params[key];
    if (typeof value === "string") next.set(key, value);
  }
  if (before) next.set("before", before);
  return next.size ? `/admin/activity?${next}` : "/admin/activity";
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("activity") };
}

export default async function AdminActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const ctx = await requireScope("activity");
  const params = await searchParams;
  const category = isActivityCategory(params.category) ? params.category : undefined;
  const period: ActivityPeriod = typeof params.period === "string" && params.period in ACTIVITY_PERIODS ? (params.period as ActivityPeriod) : "30";
  const actorId = typeof params.person === "string" && /^[0-9a-f-]{36}$/i.test(params.person) ? params.person : undefined;
  const before = typeof params.before === "string" && !Number.isNaN(Date.parse(params.before)) ? params.before : undefined;
  const t = await getTranslations("activity");
  const tHide = await getTranslations("hide");
  const format = await getFormatter();
  const [events, members, clients] = await Promise.all([
    listCompanyActivity(ctx.active.companyId, { category, actorId, sinceDays: ACTIVITY_PERIODS[period], before }),
    listMembers(ctx.active.companyId),
    listClients(ctx.active.companyId, { includeArchived: true }),
  ]);
  // Names are resolved only from what this admin may already see (RLS); the log itself stores ids.
  const people = new Map(members.map((m) => [m.userId, m.fullName ?? m.email]));
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4">
        <ActivityFilters people={members.map((m) => ({ id: m.userId, name: m.fullName ?? m.email }))} />
      </div>
      {events.length === 0 ? (
        <EmptyState icon={<ActivityIcon />} title={category || actorId || before ? t("emptyFiltered") : t("emptyTitle")} />
      ) : (
        <Card className="divide-y overflow-hidden">
          {events.map((e) => {
            const d = describeEvent(e, { people, clientNames, hideCategory: (c) => (HIDE_CATEGORY_KEYS.includes(c) ? tHide(`category.${c as HideCategory}`) : c) });
            return (
              <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand/60" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{e.actor?.full_name ?? e.actor?.email ?? t("system")}</span>{" "}
                    <span className="text-muted-foreground">{t(`actions.${d.key}`, d.values)}</span>
                  </p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={e.created_at}>
                  {format.dateTime(new Date(e.created_at), { dateStyle: "medium", timeStyle: "short" })}
                </time>
              </div>
            );
          })}
        </Card>
      )}
      <div className="mt-4 flex flex-wrap gap-4 text-[13px]">
        {before ? (
          <Link href={pageHref(params, null)} className="text-muted-foreground hover:text-foreground hover:underline">
            {t("newest")}
          </Link>
        ) : null}
        {events.length === ACTIVITY_PAGE_SIZE ? (
          <Link href={pageHref(params, events[events.length - 1].created_at)} className="text-brand hover:underline">
            {t("older")}
          </Link>
        ) : null}
      </div>
    </PageContainer>
  );
}
