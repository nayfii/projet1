import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { TeamManager } from "@/modules/platform/ui/team-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("team") };
}

/** Our team: who has the console (never customer content), managed here instead of a hosting setting. */
export default async function PlatformTeamPage() {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("platformTeam");
  const supabase = await createClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.rpc("platform_team"),
    supabase.from("platform_admin_invites").select("email, created_at").order("created_at"),
  ]);
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />
      <TeamManager
        members={(members ?? []).map((m) => ({ userId: m.user_id, email: m.email, name: m.full_name, addedAt: m.added_at, inCompany: m.in_company, me: m.user_id === ctx.user.id }))}
        invites={(invites ?? []).map((i) => ({ email: i.email, createdAt: i.created_at }))}
        appUrl={publicEnv.appUrl}
      />
    </PageContainer>
  );
}
