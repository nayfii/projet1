import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActivityIcon } from "lucide-react";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listCompanyActivity } from "@/modules/audit/server/queries";
import { listMembers } from "@/modules/organizations/server/queries";
import { listClients } from "@/modules/clients/server/queries";
import { describeEvent } from "@/modules/audit/describe";
import { AUTO_CATEGORIES, type HideCategory } from "@/modules/hide/categories";

const HIDE_CATEGORY_KEYS: string[] = [...AUTO_CATEGORIES, "redacted"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("activity") };
}

export default async function AdminActivityPage() {
  const ctx = await requireScope("activity");
  const t = await getTranslations("activity");
  const tHide = await getTranslations("hide");
  const format = await getFormatter();
  const [events, members, clients] = await Promise.all([
    listCompanyActivity(ctx.active.companyId),
    listMembers(ctx.active.companyId),
    listClients(ctx.active.companyId, { includeArchived: true }),
  ]);
  // Names are resolved only from what this admin may already see (RLS); the log itself stores ids.
  const people = new Map(members.map((m) => [m.userId, m.fullName ?? m.email]));
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      {events.length === 0 ? (
        <EmptyState icon={<ActivityIcon />} title={t("emptyTitle")} />
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
    </PageContainer>
  );
}
