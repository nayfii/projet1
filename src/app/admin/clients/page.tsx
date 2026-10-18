import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer } from "@/components/ui/page-header";
import { listClients } from "@/modules/clients/server/queries";
import { listMembers } from "@/modules/organizations/server/queries";
import { ClientsManager } from "@/modules/clients/ui/clients-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("clients") };
}

export default async function AdminClientsPage({ searchParams }: PageProps<"/admin/clients">) {
  const ctx = await requireScope("clients");
  const t = await getTranslations("clients");
  const params = await searchParams;
  const [clients, members] = await Promise.all([
    listClients(ctx.active.companyId, { includeArchived: true }),
    listMembers(ctx.active.companyId),
  ]);
  return (
    <PageContainer>
      <ClientsManager
        header={{ title: t("adminTitle"), description: t("adminDescription") }}
        clients={clients}
        members={members
          .filter((m) => m.status === "active" && m.role !== "owner")
          .map((m) => ({ userId: m.userId, name: m.fullName ?? m.email }))}
        startWithNew={params.new === "1"}
      />
    </PageContainer>
  );
}
