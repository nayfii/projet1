import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { getMyMemberCard } from "@/modules/organizations/server/queries";
import { ProfileForms } from "@/modules/identity/ui/profile-forms";
import { AvatarStudio } from "@/modules/avatars/ui/avatar-studio";
import { avatarRate } from "@/modules/avatars/server/store";
import { fakeProviderEnabled } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { PersonalMemory } from "@/modules/memory/ui/personal-memory";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage() {
  const ctx = await requireMember();
  const t = await getTranslations("profile");
  const tAvatar = await getTranslations("avatar");
  const supabase = await createClient();
  const [card, rate, { data: notes }] = await Promise.all([
    getMyMemberCard(ctx.active.companyId, ctx.user.id),
    avatarRate(),
    supabase.from("personal_memory").select("id, content").eq("company_id", ctx.active.companyId).eq("user_id", ctx.user.id).order("created_at"),
  ]);
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title={t("title")} description={t("description")} />
      <section aria-labelledby="avatar-title" className="mb-10 rounded-2xl border bg-card px-6 py-8">
        <h2 id="avatar-title" className="text-center text-[15px] font-semibold tracking-tight">
          {tAvatar("title")}
        </h2>
        <p className="mx-auto mt-1 mb-8 max-w-sm text-center text-sm text-muted-foreground">{tAvatar("description")}</p>
        <AvatarStudio name={ctx.profile.fullName ?? ctx.user.email} currentUrl={ctx.profile.avatarUrl} credits={rate.credits} testMode={fakeProviderEnabled()} />
      </section>
      <PersonalMemory notes={notes ?? []} />
      <ProfileForms
        email={ctx.user.email}
        fullName={ctx.profile.fullName ?? ""}
        locale={(await getLocale()) as "fr" | "en"}
        jobTitle={card?.job_title ?? ""}
        expertise={(card?.expertise ?? []).join(", ")}
        optOut={card?.who_can_help_opt_out ?? false}
      />
    </PageContainer>
  );
}
