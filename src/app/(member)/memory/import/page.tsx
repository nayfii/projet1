import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRightIcon, LockIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { importTutorialVideoUrl } from "@/lib/env";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ComingSoon } from "@/components/ui/coming-soon";
import { importPageData, PENDING_DAYS } from "@/modules/knowledge-import/server/queries";
import { TutorialVideo } from "@/modules/knowledge-import/ui/tutorial-video";
import { ImportFlow } from "@/modules/knowledge-import/ui/import-flow";
import { ImportReview } from "@/modules/knowledge-import/ui/import-review";
import { ImportHistory } from "@/modules/knowledge-import/ui/import-history";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("knowledgeImport");
  return { title: t("title") };
}

/**
 * "Enrichir mes connaissances" (CLAUDE.md §12): bring what former AI tools knew about one's work,
 * without one's private life. Reached from Settings → Conscience, Conscience, the home page and onboarding.
 */
export default async function KnowledgeImportPage({ searchParams }: PageProps<"/memory/import">) {
  const ctx = await requireMember();
  const params = await searchParams;
  const selected = typeof params.import === "string" ? params.import : null;
  const onboarding = params.from === "onboarding";
  const [t, data] = await Promise.all([getTranslations("knowledgeImport"), importPageData(ctx, selected)]);
  const reviewing = data.reviewId !== null && data.proposals.length > 0;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-8">
        {!data.ready ? (
          <div className="flex items-center gap-3 rounded-2xl border bg-card p-5 text-sm text-muted-foreground" data-testid="import-not-ready">
            <ComingSoon />
            {t("notReady")}
          </div>
        ) : reviewing ? (
          <ImportReview key={data.reviewId} importId={data.reviewId!} proposals={data.proposals} destinations={data.destinations} />
        ) : (
          <>
            <TutorialVideo url={importTutorialVideoUrl()} />
            <section className="space-y-2 rounded-2xl border bg-card p-5" aria-labelledby="privacy-title">
              <h2 id="privacy-title" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                <LockIcon className="size-4" />
                {t("privacyTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("privacyBody")}</p>
              <details className="group text-sm">
                <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">{t("howTitle")}</summary>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] text-muted-foreground">
                  <li>{t("how1")}</li>
                  <li>{t("how2")}</li>
                  <li>{t("how3")}</li>
                  <li>{t("how4")}</li>
                  <li>{t("how5", { days: PENDING_DAYS })}</li>
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">{t("howLimit")}</p>
              </details>
            </section>
            <ImportFlow onboarding={onboarding} />
          </>
        )}
        <ImportHistory history={data.history} reviewId={reviewing ? data.reviewId : null} />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/profile#personal-memory">
              {t("seeMine")}
              <ArrowRightIcon />
            </Link>
          </Button>
          {onboarding ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/chat">
                {t("skipToChat")}
                <ArrowRightIcon />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}
