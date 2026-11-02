import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { CheckCircle2Icon, ExternalLinkIcon, MonitorCheckIcon, XCircleIcon } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { githubConfigured, listWorkflowRuns } from "@/modules/platform/server/github";
import { runStatus } from "@/modules/platform/releases";
import { AutoRefresh, CheckNowButton } from "@/modules/platform/ui/release-controls";
import { SetupNotice } from "@/modules/platform/ui/setup-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("preview") };
}

type CheckResult = { role: "owner" | "member"; screen: string; path: string; ok: boolean; error?: string | null; image?: string | null };

/**
 * Preview: each live version seen by a demo boss and a demo employee of our fictional company, with
 * what was checked on each screen. Never a customer's space.
 */
export default async function PreviewPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platformReleases");
  const format = await getFormatter();
  const supabase = await createClient();
  const configured = githubConfigured();
  const [{ data: checks }, runs] = await Promise.all([
    supabase.from("platform_check_runs").select("id, version, status, results, finished_at").order("finished_at", { ascending: false }).limit(10),
    configured ? listWorkflowRuns("verify.yml", 3) : Promise.resolve(null),
  ]);
  const latest = checks?.[0] ?? null;
  const results = ((latest?.results ?? []) as CheckResult[]).filter((r) => r && typeof r.screen === "string");
  const images = results.map((r) => r.image).filter((p): p is string => Boolean(p));
  const { data: signed } = images.length ? await supabase.storage.from("platform-checks").createSignedUrls(images, 3600) : { data: [] };
  const urlFor = new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path!, s.signedUrl]));
  const running = Boolean(runs?.ok && runs.data.some((r) => runStatus(r) === "running"));
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const column = (role: CheckResult["role"]) => (
    <section className="space-y-3" aria-labelledby={`role-${role}`}>
      <h2 id={`role-${role}`} className="text-sm font-medium">
        {t(`role.${role}`)}
      </h2>
      {results
        .filter((r) => r.role === role)
        .map((r) => {
          const url = r.image ? urlFor.get(r.image) : undefined;
          return (
            <Card key={`${r.role}-${r.screen}`} className="overflow-hidden">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="block border-b bg-muted/40">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from our storage */}
                  <img src={url} alt={t("screenAlt", { screen: t(`screen.${r.screen}` as "screen.home"), role: t(`role.${role}`) })} className="aspect-[16/10] w-full object-cover object-top" />
                </a>
              ) : null}
              <div className="flex items-start gap-2 px-4 py-3 text-sm">
                {r.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{t(`screen.${r.screen}` as "screen.home")}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.path}</span>
                  {!r.ok && r.error ? <span className="mt-0.5 block text-[13px] text-destructive">{r.error}</span> : null}
                </span>
              </div>
            </Card>
          );
        })}
    </section>
  );

  return (
    <PageContainer className="max-w-6xl">
      <AutoRefresh active={running} />
      <PageHeader title={t("previewTitle")} description={t("previewDescription")} actions={<CheckNowButton disabledReason={configured ? (running ? t("checkRunning") : null) : t("notConfiguredShort")} />} />
      {!configured ? <SetupNotice className="mb-6" /> : null}

      {latest ? (
        <>
          <Card className="mb-6 flex flex-wrap items-center gap-3 p-5">
            <Badge variant={latest.status === "passed" ? "success" : "destructive"}>{t(`checkStatus.${latest.status as "passed" | "failed"}`)}</Badge>
            <span className="text-sm font-medium">{t("checkedVersion", { version: latest.version ?? "—" })}</span>
            <span className="text-[13px] text-muted-foreground">{date(latest.finished_at)}</span>
            <span className="ml-auto text-[13px] text-muted-foreground">
              {t("screensOk", { ok: results.filter((r) => r.ok).length, total: results.length })}
            </span>
          </Card>
          <div className="grid gap-6 md:grid-cols-2">
            {column("owner")}
            {column("member")}
          </div>
        </>
      ) : (
        <EmptyState icon={<MonitorCheckIcon />} title={t("previewEmptyTitle")} description={t("previewEmpty")} />
      )}

      {(checks?.length ?? 0) > 1 || (runs?.ok && runs.data.length > 0) ? (
        <section className="mt-10 space-y-3">
          <h2 className="text-sm font-medium">{t("checksHistory")}</h2>
          <Card className="divide-y overflow-hidden">
            {runs?.ok
              ? runs.data
                  .filter((r) => runStatus(r) === "running")
                  .map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <Badge variant="warning">{t("run.running")}</Badge>
                      <span className="flex-1 text-muted-foreground">{date(r.createdAt)}</span>
                      <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline">
                        {t("details")}
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    </div>
                  ))
              : null}
            {(checks ?? []).map((c) => {
              const list = (c.results ?? []) as CheckResult[];
              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Badge variant={c.status === "passed" ? "success" : "destructive"}>{t(`checkStatus.${c.status as "passed" | "failed"}`)}</Badge>
                  <span className="font-medium">{c.version ?? "—"}</span>
                  <span className="flex-1 text-muted-foreground">{date(c.finished_at)}</span>
                  <span className="text-[13px] text-muted-foreground">{t("screensOk", { ok: list.filter((r) => r?.ok).length, total: list.length })}</span>
                </div>
              );
            })}
          </Card>
        </section>
      ) : null}
    </PageContainer>
  );
}
