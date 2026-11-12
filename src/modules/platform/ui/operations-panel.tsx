import { getFormatter, getTranslations } from "next-intl/server";
import { ActivityIcon, ClockIcon, DownloadIcon, PlugIcon, WorkflowIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { classifyClock, classifyWorkflowQueue, type ClockStatus, type OperationsHealth, type QueueStatus } from "../health";

const BADGE: Record<ClockStatus | QueueStatus, "success" | "warning" | "destructive" | "neutral"> = {
  on_time: "success",
  late: "warning",
  never: "destructive",
  idle: "neutral",
  working: "success",
  stuck: "destructive",
};

/**
 * Our operations at a glance (V1.1 phase 10): the workflows' clock, their queue, knowledge imports,
 * connected apps needing a reconnection, and how long requests take. Counts, codes and times only.
 */
export async function OperationsPanel({ ops }: { ops: OperationsHealth | null }) {
  const t = await getTranslations("platformHealth.ops");
  const format = await getFormatter();
  const now = new Date();
  if (!ops) {
    return (
      <Card className="mt-6 p-5 text-[13px] text-muted-foreground" data-testid="operations">
        {t("unavailable")}
      </Card>
    );
  }
  const n = (v: number) => format.number(v, { maximumFractionDigits: 0 });
  const ago = (iso: string | null | undefined) => (iso ? format.relativeTime(new Date(iso), now) : t("never"));
  const seconds = (ms: number | null) => (ms === null ? "—" : t("seconds", { s: format.number(ms / 1000, { maximumFractionDigits: ms < 10_000 ? 2 : 0 }) }));
  const clock = classifyClock(ops.clock?.at, now.getTime());
  const queue = classifyWorkflowQueue(ops.workflows, now.getTime());
  const stat = (label: string, value: string, warn = false) => (
    <div>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className={warn ? "mt-0.5 text-[15px] font-medium tabular-nums text-warning" : "mt-0.5 text-[15px] font-medium tabular-nums"}>{value}</dd>
    </div>
  );

  return (
    <section className="mt-8" data-testid="operations">
      <h2 className="mb-3 text-sm font-medium">{t("title")}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-5" data-testid="ops-clock">
          <div className="flex items-start justify-between gap-2">
            <h3 className="flex items-center gap-2 font-medium">
              <ClockIcon className="size-4 text-muted-foreground" />
              {t("clockTitle")}
            </h3>
            <Badge variant={BADGE[clock]}>{t(`clock.${clock}`)}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            {stat(t("lastRun"), ago(ops.clock?.at))}
            {stat(t("scheduled"), n(ops.clock?.detail.scheduled ?? 0))}
            {stat(t("executed"), n(ops.clock?.detail.executed ?? 0))}
          </dl>
          <p className="mt-3 text-[13px] text-muted-foreground">{clock === "on_time" ? t("clockOk") : t("clockHelp")}</p>
        </Card>

        <Card className="p-5" data-testid="ops-workflows">
          <div className="flex items-start justify-between gap-2">
            <h3 className="flex items-center gap-2 font-medium">
              <WorkflowIcon className="size-4 text-muted-foreground" />
              {t("workflowsTitle")}
            </h3>
            <Badge variant={BADGE[queue]}>{t(`queue.${queue}`)}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-4 gap-3 text-sm">
            {stat(t("active"), n(ops.workflows.active))}
            {stat(t("queued"), n(ops.workflows.queued + ops.workflows.waiting))}
            {stat(t("succeeded"), n(ops.workflows.succeeded))}
            {stat(t("failed"), n(ops.workflows.failed), ops.workflows.failed > 0)}
          </dl>
          <p className="mt-3 text-[13px] text-muted-foreground">
            {ops.workflows.stuck > 0
              ? t("stuck", { count: ops.workflows.stuck })
              : ops.workflows.top_error
                ? t("topError", { code: ops.workflows.top_error })
                : ops.workflows.oldest_queued_at
                  ? t("oldestQueued", { when: ago(ops.workflows.oldest_queued_at) })
                  : t("noFailures")}
          </p>
        </Card>

        <Card className="p-5" data-testid="ops-imports">
          <h3 className="flex items-center gap-2 font-medium">
            <DownloadIcon className="size-4 text-muted-foreground" />
            {t("importsTitle")}
          </h3>
          <dl className="mt-4 grid grid-cols-4 gap-3 text-sm">
            {stat(t("inProgress"), n(ops.imports.analyzing))}
            {stat(t("started"), n(ops.imports.started))}
            {stat(t("done"), n(ops.imports.done))}
            {stat(t("stalled"), n(ops.imports.stalled), ops.imports.stalled > 0)}
          </dl>
        </Card>

        <Card className="p-5" data-testid="ops-integrations">
          <h3 className="flex items-center gap-2 font-medium">
            <PlugIcon className="size-4 text-muted-foreground" />
            {t("integrationsTitle")}
          </h3>
          {ops.integrations.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted-foreground">{t("noConnections")}</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] text-muted-foreground">
                  <th className="py-1 font-normal">{t("provider")}</th>
                  <th className="py-1 text-right font-normal">{t("active")}</th>
                  <th className="py-1 text-right font-normal">{t("reconnect")}</th>
                  <th className="py-1 text-right font-normal">{t("revoked")}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {ops.integrations.map((i) => (
                  <tr key={i.provider}>
                    <td className="py-1 capitalize">{i.provider}</td>
                    <td className="py-1 text-right">{n(i.active)}</td>
                    <td className={i.needs_reconnect > 0 ? "py-1 text-right text-warning" : "py-1 text-right"}>{n(i.needs_reconnect)}</td>
                    <td className="py-1 text-right">{n(i.revoked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-5 md:col-span-2" data-testid="ops-latency">
          <h3 className="flex items-center gap-2 font-medium">
            <ActivityIcon className="size-4 text-muted-foreground" />
            {t("latencyTitle")}
          </h3>
          {ops.latency.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted-foreground">{t("noTraffic")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-3 w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-muted-foreground">
                    <th className="py-1 font-normal">{t("feature")}</th>
                    <th className="py-1 text-right font-normal">{t("requests")}</th>
                    <th className="py-1 text-right font-normal">{t("errors")}</th>
                    <th className="py-1 text-right font-normal">{t("p50")}</th>
                    <th className="py-1 text-right font-normal">{t("p95")}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {ops.latency.map((l) => (
                    <tr key={l.feature}>
                      <td className="py-1">{l.feature}</td>
                      <td className="py-1 text-right">{n(l.requests)}</td>
                      <td className={l.errors > 0 ? "py-1 text-right text-warning" : "py-1 text-right"}>{n(l.errors)}</td>
                      <td className="py-1 text-right">{seconds(l.p50_ms)}</td>
                      <td className="py-1 text-right">{seconds(l.p95_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[13px] text-muted-foreground">{t("latencyNote")}</p>
        </Card>
      </div>
    </section>
  );
}
