import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { PageContainer } from "@/components/ui/page-header";
import { listCompaniesForPlatform, listPlans } from "@/modules/platform/server/queries";
import { getPlatformCompanyCredits } from "@/modules/usage/server/queries";
import { CompaniesManager } from "@/modules/platform/ui/companies-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("companies") };
}

export default async function PlatformCompaniesPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platform");
  const [companies, plans, credits] = await Promise.all([listCompaniesForPlatform(), listPlans(), getPlatformCompanyCredits()]);
  return (
    <PageContainer className="max-w-6xl">
      <CompaniesManager
        header={{ title: t("companiesTitle"), description: t("companiesDescription") }}
        companies={companies.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          planId: c.plan_id,
          planName: c.plan_name,
          seatLimit: c.seat_limit,
          activeSeats: Number(c.active_seats),
          pendingInvitations: Number(c.pending_invitations),
          ownerEmail: c.owner_email,
          createdAt: c.created_at,
          credits: credits.get(c.id) ?? null,
        }))}
        plans={plans.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name }))}
      />
    </PageContainer>
  );
}
