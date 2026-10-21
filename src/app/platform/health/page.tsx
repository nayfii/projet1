import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ClapperboardIcon, DatabaseIcon } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLastProviderTests, getProviderHealth } from "@/modules/platform/server/queries";
import { classifyProvider, classifyRenderQueue, type HealthStatus, type RenderStatus } from "@/modules/platform/health";
import { ProviderTestButton } from "@/modules/platform/ui/provider-test-button";
import { configuredProviders } from "@/modules/providers/server/registry";
import { embeddingModelName, embeddingsAvailable } from "@/modules/providers/server/embeddings";
import { PROVIDER_BRANDS, PROVIDER_ERROR_CODES, PROVIDER_IDS } from "@/modules/providers/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("health") };
}

const STATUS_BADGE: Record<HealthStatus | RenderStatus, "success" | "warning" | "destructive" | "neutral" | "outline"> = {
  operational: "success",
  degraded: "warning",
  down: "destructive",
  no_traffic: "neutral",
  not_configured: "outline",
  idle: "neutral",
  working: "success",
  stuck: "destructive",
};

const knownCode = (code: string | null) => ((PROVIDER_ERROR_CODES as readonly string[]).includes(code ?? "") ? (code as (typeof PROVIDER_ERROR_CODES)[number]) : "unknown");

/** Provider health (CLAUDE.md §4.9): computed from our own requests over the last 24 hours. Metadata only. */
export default async function PlatformHealthPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platformHealth");
  const format = await getFormatter();
  const now = new Date();
  const [health, tests] = await Promise.all([getProviderHealth(), getLastProviderTests()]);
  const configured = configuredProviders();
  const ago = (iso: string | null) => (iso ? format.relativeTime(new Date(iso), now) : t("never"));
  const n = (v: number) => format.number(v, { maximumFractionDigits: 0 });
  const renderStatus = classifyRenderQueue(health.render, now.getTime());

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-3 md:grid-cols-3">
        {PROVIDER_IDS.map((id) => {
          const traffic = health.providers.find((p) => p.provider === id);
          const test = tests.get(id);
          const status = classifyProvider(configured.has(id), traffic, test);
          const name = PROVIDER_BRANDS[id];
          const errorRate = traffic && traffic.requests > 0 ? traffic.service_errors / traffic.requests : 0;
          return (
            <Card key={id} className="flex flex-col p-5" data-testid={`provider-${id}`}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-medium">{name}</h2>
                <Badge variant={STATUS_BADGE[status]}>{t(`status.${status}`)}</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                <div>
                  <dt className="text-[12px] text-muted-foreground">{t("requests")}</dt>
                  <dd className="tabular-nums">{n(traffic?.requests ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted-foreground">{t("errorRate")}</dt>
                  <dd className={errorRate > 0.05 ? "tabular-nums text-warning" : "tabular-nums"}>
                    {traffic?.requests ? format.number(errorRate, { style: "percent", maximumFractionDigits: 1 }) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted-foreground">{t("latency")}</dt>
                  <dd className="tabular-nums">{traffic?.avg_latency_ms ? t("seconds", { s: format.number(traffic.avg_latency_ms / 1000, { maximumFractionDigits: 1 }) }) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted-foreground">{t("lastOk")}</dt>
                  <dd>{ago(traffic?.last_ok_at ?? null)}</dd>
                </div>
              </dl>
              {traffic?.top_error ? <p className="mt-3 text-[13px] text-muted-foreground">{t("topError", { reason: t(`codes.${knownCode(traffic.top_error)}`) })}</p> : null}
              <div className="min-h-4 flex-1" />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className="text-[12px] text-muted-foreground">
                  {test
                    ? test.ok
                      ? t("lastTestOk", { when: ago(test.at), ms: n(test.latencyMs ?? 0) })
                      : t("lastTestFailed", { when: ago(test.at), reason: t(`codes.${knownCode(test.code)}`) })
                    : t("noTest")}
                </p>
                {configured.has(id) ? <ProviderTestButton provider={id} name={name} /> : <span className="text-[12px] text-muted-foreground">{t("addKey")}</span>}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Card className="p-5" data-testid="render-queue">
          <div className="flex items-start justify-between gap-2">
            <h2 className="flex items-center gap-2 font-medium">
              <ClapperboardIcon className="size-4 text-muted-foreground" />
              {t("renderTitle")}
            </h2>
            <Badge variant={STATUS_BADGE[renderStatus]}>{t(`render.${renderStatus}`)}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-[12px] text-muted-foreground">{t("queued")}</dt>
              <dd className="tabular-nums">{n(health.render.queued)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted-foreground">{t("running")}</dt>
              <dd className="tabular-nums">{n(health.render.running)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted-foreground">{t("finished")}</dt>
              <dd className="tabular-nums">{t("finishedValue", { ok: health.render.succeeded, failed: health.render.failed })}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[13px] text-muted-foreground">
            {renderStatus === "stuck" ? t("renderStuck") : t("lastVideo", { when: ago(health.render.last_succeeded_at) })}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="flex items-center gap-2 font-medium">
              <DatabaseIcon className="size-4 text-muted-foreground" />
              {t("embeddingsTitle")}
            </h2>
            <Badge variant={embeddingsAvailable() ? "success" : "outline"}>{t(embeddingsAvailable() ? "configured" : "status.not_configured")}</Badge>
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">{t("embeddingsBody", { model: embeddingModelName() })}</p>
        </Card>
      </div>

      <div className="mt-6 space-y-1 text-[13px] text-muted-foreground">
        <p>{t("noteSource")}</p>
        <p>{t("noteTest")}</p>
      </div>
    </PageContainer>
  );
}
