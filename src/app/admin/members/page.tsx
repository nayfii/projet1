import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer } from "@/components/ui/page-header";
import { listMembers, listPendingInvitations } from "@/modules/organizations/server/queries";
import { MembersManager } from "@/modules/organizations/ui/members-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("members") };
}

export default async function AdminMembersPage() {
  const ctx = await requireScope("members");
  const t = await getTranslations("members");
  const [members, invitations] = await Promise.all([
    listMembers(ctx.active.companyId),
    listPendingInvitations(ctx.active.companyId),
  ]);
  return (
    <PageContainer>
      <MembersManager
        header={{ title: t("title"), description: t("description") }}
        members={members}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at }))}
        currentUserId={ctx.user.id}
        isOwner={ctx.active.role === "owner"}
      />
    </PageContainer>
  );
}
