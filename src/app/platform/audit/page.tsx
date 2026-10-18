import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ScrollTextIcon } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listPlatformActivity } from "@/modules/audit/server/queries";
import { describeEvent } from "@/modules/audit/describe";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("audit") };
}

export default async function PlatformAuditPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("activity");
  const tp = await getTranslations("platform");
  const format = await getFormatter();
  const events = await listPlatformActivity();
  return (
    <PageContainer>
      <PageHeader title={tp("auditTitle")} description={tp("auditDescription")} />
      {events.length === 0 ? (
        <EmptyState icon={<ScrollTextIcon />} title={t("emptyTitle")} />
      ) : (
        <Card className="divide-y overflow-hidden">
          {events.map((e) => {
            const d = describeEvent(e, {});
            return (
              <div key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand/60" />
                <p className="min-w-0 flex-1">
                  {t(`actions.${d.key}`, d.values)}
                  {e.target_id ? <span className="ml-2 font-mono text-xs text-muted-foreground">{e.target_id.slice(0, 8)}</span> : null}
                </p>
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
