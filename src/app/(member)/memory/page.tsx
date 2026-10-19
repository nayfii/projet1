import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRightIcon, BriefcaseIcon, BuildingIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listMemorySpaces } from "@/modules/memory/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory");
  return { title: t("title") };
}

/** The memories this person can read: the company's, then each client's (RLS + SQL rights). */
export default async function MemoryPage() {
  const ctx = await requireMember();
  const t = await getTranslations("memory");
  const spaces = await listMemorySpaces(ctx);
  const company = spaces.find((s) => s.kind === "company");
  const clients = spaces.filter((s) => s.kind === "client" && !s.clientArchived);

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title={t("title")} description={t("description")} />
      {company ? (
        <Link href={`/memory/${company.spaceId}`} className="group mb-8 block rounded-xl">
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
              {!s.canWrite ? <Badge variant="outline">{t("readOnly")}</Badge> : null}
              <ArrowRightIcon className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </Card>
      )}
    </PageContainer>
  );
}
