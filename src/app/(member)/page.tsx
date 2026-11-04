import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRightIcon, BriefcaseIcon, BrainIcon, CheckIcon, FileTextIcon, KeyRoundIcon, LayoutGridIcon, MessageSquareIcon, UsersIcon } from "lucide-react";
import { requireMember, type MemberContext } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listClients } from "@/modules/clients/server/queries";

/** The setup checklist (CLAUDE.md §11): what onboarding no longer asks, done when the company has it. */
async function setupCounts(ctx: MemberContext) {
  const supabase = await createClient();
  const companyId = ctx.active.companyId;
  const [members, invitations, documents] = await Promise.all([
    supabase.from("company_members").select("user_id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "active"),
    supabase.from("invitations").select("id", { count: "exact", head: true }).eq("company_id", companyId).is("accepted_at", null).is("revoked_at", null),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("company_id", companyId),
  ]);
  return { team: (members.count ?? 0) > 1 || (invitations.count ?? 0) > 0, documents: (documents.count ?? 0) > 0 };
}

export default async function HomePage() {
  const ctx = await requireMember();
  const t = await getTranslations("home");
  const tPassword = await getTranslations("password");
  const canSetUp = hasScope(ctx.active, "company");
  const [clients, counts] = await Promise.all([listClients(ctx.active.companyId), canSetUp ? setupCounts(ctx) : Promise.resolve(null)]);
  const firstName = ctx.profile.fullName?.split(" ")[0];
  const setupPending = canSetUp && !ctx.active.onboardingCompletedAt;
  const checklist = counts
    ? ([
        { key: "invite", icon: UsersIcon, done: counts.team },
        { key: "client", icon: BriefcaseIcon, done: clients.length > 0 },
        { key: "document", icon: FileTextIcon, done: counts.documents },
      ] as const)
    : [];
  const showChecklist = checklist.some((item) => !item.done);

  const tiles = [
    { icon: MessageSquareIcon, title: t("askTitle"), body: t("askBody"), href: "/chat" },
    { icon: BriefcaseIcon, title: t("clientsTitle"), body: t("clientsBody", { count: clients.length }), href: "/clients" },
    { icon: BrainIcon, title: t("memoryTitle"), body: t("memoryBody"), href: "/memory" },
    { icon: LayoutGridIcon, title: t("libraryTitle"), body: t("libraryBody"), href: "/apps" },
  ];

  return (
    <PageContainer className="max-w-4xl">
      <div className="space-y-1 pb-10 pt-4 sm:pt-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {firstName ? t("greetingNamed", { name: firstName }) : t("greeting")}
        </h1>
        <p className="text-muted-foreground">{t("subtitle", { company: ctx.active.companyName })}</p>
      </div>

      {setupPending ? (
        <div className="mb-8 flex flex-col gap-3 rounded-xl border bg-brand-soft/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">{t("finishSetup")}</p>
          <Button asChild size="sm" variant="brand">
            <Link href="/onboarding?step=company">
              {t("finishSetupCta")}
              <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      ) : null}

      {!ctx.profile.passwordSetAt ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="password-reminder">
          <p className="flex items-center gap-2 text-sm">
            <KeyRoundIcon className="size-4 shrink-0 text-brand" />
            {tPassword("reminder")}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/profile#password">{tPassword("reminderCta")}</Link>
          </Button>
        </div>
      ) : null}

      {showChecklist ? (
        <section aria-labelledby="setup" className="mb-8" data-testid="setup-checklist">
          <h2 id="setup" className="mb-3 text-[13px] font-medium text-muted-foreground">
            {t("setupTitle", { done: checklist.filter((i) => i.done).length, total: checklist.length })}
          </h2>
          <ol className="grid gap-2 sm:grid-cols-3">
            {checklist.map(({ key, icon: Icon, done }) => (
              <li key={key}>
                {done ? (
                  <div className="flex h-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                    <span className="flex size-7 items-center justify-center rounded-full bg-success-soft text-success">
                      <CheckIcon className="size-4" />
                    </span>
                    <span className="line-through decoration-muted-foreground/40">{t(`setup.${key}`)}</span>
                  </div>
                ) : (
                  <Link
                    href={`/onboarding?step=${key}`}
                    className={cn("group flex h-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm transition-colors hover:border-foreground/25")}
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex-1 font-medium">{t(`setup.${key}`)}</span>
                    <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map(({ icon: Icon, title, body, href }) => (
          <Link key={title} href={href} className="rounded-xl">
            <Card className="h-full p-5 transition-colors hover:border-foreground/20">
              <div className="flex items-start justify-between">
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </div>
                <ArrowRightIcon className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-4 text-[15px] font-medium">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </Card>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
