import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { getCompanyPlan, listMembers } from "@/modules/organizations/server/queries";
import { getCompanyAiSettings, getMemberCredits } from "@/modules/usage/server/queries";
import { getMyQuota } from "@/modules/usage/server/quota";
import { QuotasManager } from "@/modules/usage/ui/quotas-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("quotas") };
}

export default async function AdminQuotasPage() {
  const ctx = await requireScope("quotas");
  const t = await getTranslations("quotas");
  const companyId = ctx.active.companyId;
  const [members, credits, settings, quota, plan] = await Promise.all([
    listMembers(companyId),
    getMemberCredits(companyId),
    getCompanyAiSettings(companyId),
    getMyQuota(companyId),
    getCompanyPlan(companyId),
  ]);
  const byUser = new Map(credits.map((c) => [c.userId, c]));
  const planCredits = Number(plan?.monthly_credits ?? 0);
  const limit = quota?.status.companyLimit ?? planCredits;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />
      <QuotasManager
        company={{ limit, used: quota?.status.companyUsed ?? 0, planCredits, extraCredits: Math.max(limit - planCredits, 0) }}
        defaultLimit={settings.defaultUserMonthlyCredits === null ? null : Number(settings.defaultUserMonthlyCredits)}
        members={members
          .filter((m) => m.status === "active")
          .map((m) => ({
            userId: m.userId,
            name: m.fullName ?? m.email,
            email: m.email,
            avatarUrl: m.avatarUrl,
            used: byUser.get(m.userId)?.used ?? 0,
            limit: byUser.get(m.userId)?.limit ?? null,
            hasOverride: byUser.get(m.userId)?.hasOverride ?? false,
          }))}
      />
    </PageContainer>
  );
}
