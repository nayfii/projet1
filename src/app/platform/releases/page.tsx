import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExternalLinkIcon, GitCommitHorizontalIcon, RocketIcon, TriangleAlertIcon } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { releaseConfig } from "@/lib/env";
import { APP_VERSION, RELEASE_DATE, RELEASE_NOTES, nextVersion } from "@/lib/version";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { githubConfigured, listReleases, listWorkflowRuns, pendingChanges } from "@/modules/platform/server/github";
import { runStatus } from "@/modules/platform/releases";
import { AutoRefresh, ReleaseLauncher } from "@/modules/platform/ui/release-controls";
import { SetupNotice } from "@/modules/platform/ui/setup-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("releases") };
}

const RUN_BADGE = { running: "warning", succeeded: "success", failed: "destructive" } as const;

/** Versions: what runs for every company, what the next launch publishes, and the history. */
export default async function ReleasesPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platformReleases");
  const format = await getFormatter();
  const config = releaseConfig();
  const configured = githubConfigured();
  const [pending, runs, releases] = configured
    ? await Promise.all([pendingChanges(), listWorkflowRuns("release.yml", 5), listReleases(10)])
    : [null, null, null];
  const next = `v${nextVersion(APP_VERSION)}`;
  // Deployed from another branch than the production one: every change goes live without a launch.
  const liveBranch = process.env.VERCEL_GIT_COMMIT_REF ?? null;
  const branchMismatch = Boolean(liveBranch) && liveBranch !== config.releaseBranch;
  const running = Boolean(runs?.ok && runs.data.some((r) => runStatus(r) === "running"));
  const changes = pending?.ok ? pending.data.changes : [];
  const disabledReason = !configured
    ? t("notConfiguredShort")
    : running
      ? t("launchRunning")
      : pending?.ok && changes.length === 0
        ? t("nothingNew", { version: APP_VERSION })
        : pending && !pending.ok
          ? t(`errors.${pending.error}`)
          : null;
  const date = (iso: string) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "");

  return (
    <PageContainer className="max-w-4xl">
      <AutoRefresh active={running} />
      <PageHeader title={t("title")} description={t("description")} />

      <Card className="mb-6 flex flex-wrap items-end justify-between gap-4 p-6">
        <div>
          <p className="text-[13px] text-muted-foreground">{t("live")}</p>
          <p className="mt-1 text-4xl font-semibold tracking-[-0.03em]" data-testid="live-version">
            {APP_VERSION}
          </p>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{RELEASE_NOTES}</p>
        </div>
        <p className="text-[13px] text-muted-foreground">{t("liveSince", { date: format.dateTime(new Date(RELEASE_DATE), { dateStyle: "long" }) })}</p>
      </Card>

      {branchMismatch ? (
        <p className="mb-6 flex gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-[13px] text-warning" role="alert">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {t("branchMismatch", { live: liveBranch ?? "", production: config.releaseBranch })}
        </p>
      ) : null}
      {!configured ? <SetupNotice className="mb-6" /> : null}

      <section className="mb-8 space-y-3" aria-labelledby="next-version">
        <h2 id="next-version" className="flex items-center gap-2 text-sm font-medium">
          <RocketIcon className="size-4 text-muted-foreground" />
          {t("nextTitle", { version: next })}
        </h2>
        <Card className="space-y-5 p-5">
          {pending?.ok ? (
            changes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t("nothingNew", { version: APP_VERSION })}</p>
            ) : (
              <div>
                <p className="mb-2 text-[13px] text-muted-foreground">
                  {pending.data.firstRelease ? t("firstRelease", { count: changes.length }) : t("changesCount", { count: changes.length })}
                </p>
                <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
                  {changes.slice(0, 40).map((c) => (
                    <li key={c.sha} className="flex gap-2">
                      <GitCommitHorizontalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">{c.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.date ? format.dateTime(new Date(c.date), { dateStyle: "short" }) : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
          <ReleaseLauncher next={next} disabledReason={disabledReason} />
        </Card>
      </section>

      {runs?.ok && runs.data.length > 0 ? (
        <section className="mb-8 space-y-3">
          <h2 className="text-sm font-medium">{t("runsTitle")}</h2>
          <Card className="divide-y overflow-hidden">
            {runs.data.map((r) => {
              const status = runStatus(r);
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <Badge variant={RUN_BADGE[status]}>{t(`run.${status}`)}</Badge>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{date(r.createdAt)}</span>
                  <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline">
                    {t("details")}
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                </div>
              );
            })}
          </Card>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("historyTitle")}</h2>
        {releases?.ok && releases.data.length > 0 ? (
          <Card className="divide-y overflow-hidden">
            {releases.data.map((r) => (
              <div key={r.tag} className="space-y-1 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{r.tag}</span>
                  {r.tag === APP_VERSION ? <Badge variant="success">{t("liveBadge")}</Badge> : null}
                  <span className="flex-1 text-xs text-muted-foreground">{date(r.date)}</span>
                </div>
                {r.notes ? <p className="line-clamp-3 whitespace-pre-line text-[13px] text-muted-foreground">{r.notes}</p> : null}
              </div>
            ))}
          </Card>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("historyEmpty", { version: APP_VERSION })}</p>
        )}
      </section>
    </PageContainer>
  );
}
