import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExternalLinkIcon, WrenchIcon } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { githubConfigured, listWorkflowRuns, pullForBranch, type PullRequest, type WorkflowRun } from "@/modules/platform/server/github";
import { fixStatus, runTitleFor, type FixStatus } from "@/modules/platform/releases";
import { AutoRefresh, FixDecision, FixRequestForm } from "@/modules/platform/ui/release-controls";
import { SetupNotice } from "@/modules/platform/ui/setup-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("debug") };
}

const STATUS_BADGE: Record<FixStatus, "neutral" | "warning" | "success" | "destructive" | "brand" | "outline"> = {
  sending: "neutral",
  not_sent: "destructive",
  working: "warning",
  ready: "brand",
  checks_failed: "destructive",
  no_change: "outline",
  failed: "destructive",
  accepted: "success",
  rejected: "outline",
};

/**
 * Debug: describe a problem or a change; Claude Code prepares it on its own branch (GitHub Actions),
 * we accept or refuse it, and accepted changes leave with the next launched version.
 */
export default async function DebugPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platformReleases");
  const format = await getFormatter();
  const supabase = await createClient();
  const configured = githubConfigured();
  const { data: requests } = await supabase.from("platform_fix_requests").select("id, request, created_at").order("created_at", { ascending: false }).limit(10);
  const runs = configured ? await listWorkflowRuns("claude-fix.yml", 30) : null;
  const pulls = new Map<string, PullRequest | null>();
  if (configured) {
    await Promise.all(
      (requests ?? []).map(async (r) => {
        const pr = await pullForBranch(`claude-fix/${r.id}`);
        pulls.set(r.id, pr.ok ? pr.data : null);
      }),
    );
  }
  const runFor = (id: string): WorkflowRun | null => (runs?.ok ? (runs.data.find((r) => r.title === runTitleFor(id)) ?? null) : null);
  const rows = (requests ?? []).map((r) => {
    const run = runFor(r.id);
    const pr = pulls.get(r.id) ?? null;
    return { ...r, run, pr, status: configured ? fixStatus(run, pr, r.created_at) : ("not_sent" as FixStatus) };
  });
  const working = rows.some((r) => r.status === "working" || r.status === "sending");

  return (
    <PageContainer className="max-w-4xl">
      <AutoRefresh active={working} />
      <PageHeader title={t("debugTitle")} description={t("debugDescription")} />
      {!configured ? <SetupNotice className="mb-6" /> : null}

      <Card className="mb-8 space-y-3 p-5">
        <FixRequestForm disabledReason={configured ? null : t("notConfiguredShort")} />
        <p className="text-[12px] text-muted-foreground">{t("debugPrivacy")}</p>
      </Card>

      <h2 className="mb-3 text-sm font-medium">{t("requestsTitle")}</h2>
      {rows.length === 0 ? (
        <EmptyState icon={<WrenchIcon />} title={t("requestsEmptyTitle")} description={t("requestsEmpty")} />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="space-y-3 p-4" data-testid="fix-request">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_BADGE[r.status]}>{t(`fix.${r.status}`)}</Badge>
                <span className="text-xs text-muted-foreground">{format.dateTime(new Date(r.created_at), { dateStyle: "medium", timeStyle: "short" })}</span>
                <span className="ml-auto flex gap-3 text-[13px]">
                  {r.pr ? (
                    <a href={r.pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                      {t("seeChanges")}
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  ) : null}
                  {r.run ? (
                    <a href={r.run.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      {t("details")}
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  ) : null}
                </span>
              </div>
              <p className="whitespace-pre-line text-sm">{r.request.length > 600 ? `${r.request.slice(0, 600)}…` : r.request}</p>
              {r.pr?.body ? (
                <div className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="mb-1 text-[12px] font-medium text-muted-foreground">{t("claudeSummary")}</p>
                  <p className="line-clamp-6 whitespace-pre-line text-[13px]">{r.pr.body}</p>
                </div>
              ) : null}
              {r.status === "ready" ? <FixDecision requestId={r.id} /> : null}
              {r.status === "checks_failed" ? (
                <>
                  <p className="text-[13px] text-destructive">{t("checksFailedHelp")}</p>
                  <FixDecision requestId={r.id} canAccept={false} />
                </>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
