import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { listMembers } from "@/modules/organizations/server/queries";
import { PermissionsManager } from "@/modules/memory/ui/permissions-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("permissions") };
}

/** Who reads and who writes each memory, through named groups ("permissions" scope). */
export default async function AdminPermissionsPage() {
  const ctx = await requireScope("permissions");
  const t = await getTranslations("permissions");
  const companyId = ctx.active.companyId;
  const supabase = await createClient();
  const [categories, categoryMembers, spaces, grants, members] = await Promise.all([
    supabase.from("permission_categories").select("id, name, description, system_key").eq("company_id", companyId).order("created_at"),
    supabase.from("permission_category_members").select("category_id, user_id").eq("company_id", companyId),
    supabase.from("memory_spaces").select("id, kind, client:clients(name, archived_at)").eq("company_id", companyId),
    supabase.from("memory_space_grants").select("space_id, category_id, can_read, can_write").eq("company_id", companyId),
    listMembers(companyId),
  ]);

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title={t("title")} description={t("description")} />
      <PermissionsManager
        categories={(categories.data ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          systemKey: c.system_key as "everyone" | "management" | null,
          members: (categoryMembers.data ?? []).filter((m) => m.category_id === c.id).map((m) => m.user_id),
        }))}
        spaces={(spaces.data ?? [])
          .filter((s) => !s.client?.archived_at)
          .map((s) => ({
            id: s.id,
            kind: s.kind,
            // A restricted client's name is hidden from admins without access to it.
            clientName: s.kind === "client" ? (s.client?.name ?? null) : null,
            read: (grants.data ?? []).filter((g) => g.space_id === s.id && g.can_read).map((g) => g.category_id),
            write: (grants.data ?? []).filter((g) => g.space_id === s.id && g.can_write).map((g) => g.category_id),
          }))
          .sort((a, b) => (a.kind === b.kind ? (a.clientName ?? "~").localeCompare(b.clientName ?? "~") : a.kind === "company" ? -1 : 1))}
        members={members.filter((m) => m.status === "active").map((m) => ({ userId: m.userId, name: m.fullName ?? m.email, role: m.role }))}
      />
    </PageContainer>
  );
}
