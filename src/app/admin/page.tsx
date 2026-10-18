import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRightIcon } from "lucide-react";
import { requireCompanyAdmin } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getCompanyPlan, listMembers, listPendingInvitations } from "@/modules/organizations/server/queries";
import { listClients } from "@/modules/clients/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("title") };
}

export default async function AdminOverviewPage() {
  const ctx = await requireCompanyAdmin();
  const t = await getTranslations("adminOverview");
  const companyId = ctx.active.companyId;
  const canMembers = hasScope(ctx.active, "members");
  const canClients = hasScope(ctx.active, "clients");

  const [members, invitations, clients, plan] = await Promise.all([
    listMembers(companyId),
    canMembers ? listPendingInvitations(companyId) : Promise.resolve([]),
    canClients ? listClients(companyId) : Promise.resolve([]),
    getCompanyPlan(companyId),
  ]);
  const active = members.filter((m) => m.status === "active").length;
  const restricted = clients.filter((c) => c.visibility === "restricted").length;

  const stats = [
    {
      label: t("seats"),
      value: plan?.seat_limit ? t("seatsValue", { used: active, limit: plan.seat_limit }) : String(active),
      hint: canMembers ? t("pendingInvites", { count: invitations.length }) : undefined,
      href: canMembers ? "/admin/members" : undefined,
    },
    ...(canClients
      ? [{ label: t("clients"), value: String(clients.length), hint: t("restrictedCount", { count: restricted }), href: "/admin/clients" }]
      : []),
    { label: t("plan"), value: plan?.name ?? t("noPlan"), hint: t("planHint") },
  ];

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description", { company: ctx.active.companyName })} />
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => {
          const card = (
            <Card className="h-full p-5">
              <p className="text-[13px] text-muted-foreground">{s.label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{s.value}</p>
              {s.hint ? <p className="mt-1 text-[13px] text-muted-foreground">{s.hint}</p> : null}
            </Card>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="group relative rounded-xl">
              {card}
              <ArrowRightIcon className="absolute right-5 top-5 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ) : (
            <div key={s.label}>{card}</div>
          );
        })}
      </div>
      <p className="mt-8 text-[13px] text-muted-foreground">{t("usageSoon")}</p>
    </PageContainer>
  );
}
