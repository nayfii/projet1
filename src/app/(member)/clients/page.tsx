import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BriefcaseIcon, PlusIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listClients } from "@/modules/clients/server/queries";
import { AvatarStack, VisibilityBadge } from "@/modules/clients/ui/client-badges";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("clients");
  return { title: t("title") };
}

export default async function ClientsPage() {
  const ctx = await requireMember();
  const t = await getTranslations("clients");
  const clients = await listClients(ctx.active.companyId);
  const canManage = hasScope(ctx.active, "clients");

  const addButton = canManage ? (
    <Button asChild>
      <Link href="/admin/clients?new=1">
        <PlusIcon />
        {t("add")}
      </Link>
    </Button>
  ) : null;

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("memberDescription")} actions={clients.length ? addButton : null} />
      {clients.length === 0 ? (
        <EmptyState
          icon={<BriefcaseIcon />}
          title={t("emptyTitle")}
          description={canManage ? t("emptyManager") : t("emptyMember")}
          action={addButton}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="rounded-xl">
              <Card className="flex h-full flex-col gap-4 p-5 transition-colors hover:border-foreground/20">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    {c.sector ? <p className="truncate text-sm text-muted-foreground">{c.sector}</p> : null}
                  </div>
                  <VisibilityBadge visibility={c.visibility} />
                </div>
                <div className="mt-auto flex items-center justify-between">
                  {c.visibility === "restricted" ? <AvatarStack people={c.assignees} /> : <span />}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
