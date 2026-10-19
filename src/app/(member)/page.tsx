import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRightIcon, BookOpenIcon, BrainIcon, BriefcaseIcon, MessageSquareIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { PageContainer } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listClients } from "@/modules/clients/server/queries";

export default async function HomePage() {
  const ctx = await requireMember();
  const t = await getTranslations("home");
  const clients = await listClients(ctx.active.companyId);
  const firstName = ctx.profile.fullName?.split(" ")[0];
  const setupPending = hasScope(ctx.active, "company") && !ctx.active.onboardingCompletedAt;

  const tiles = [
    { icon: MessageSquareIcon, title: t("askTitle"), body: t("askBody"), href: "/chat" },
    { icon: BriefcaseIcon, title: t("clientsTitle"), body: t("clientsBody", { count: clients.length }), href: "/clients" },
    { icon: BrainIcon, title: t("memoryTitle"), body: t("memoryBody"), href: "/memory" },
    { icon: BookOpenIcon, title: t("libraryTitle"), body: t("libraryBody"), href: "/library" },
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
