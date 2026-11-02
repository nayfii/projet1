import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { canRestrictClients } from "@/lib/auth/context";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { listClients } from "@/modules/clients/server/queries";
import { ClientsDirectory } from "@/modules/clients/ui/clients-directory";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("clients");
  return { title: t("title") };
}

export default async function ClientsPage() {
  const ctx = await requireMember();
  const t = await getTranslations("clients");
  const clients = await listClients(ctx.active.companyId);
  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("memberDescription")} />
      <ClientsDirectory clients={clients} canRestrict={canRestrictClients(ctx.active)} />
    </PageContainer>
  );
}
