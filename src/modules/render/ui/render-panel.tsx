"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircleIcon, CheckCircle2Icon, ClapperboardIcon, DownloadIcon, Loader2Icon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/form";
import type { AttachmentKind } from "@/modules/conversations/types";
import { extractComposition, inspectComposition, type CompositionInfo, type CompositionProblem } from "../composition";
import { extractEditPlan, planDuration, type EditPlan } from "../edit-plan";
import { FORMAT_KEYS, renderCredits, type RenderKind, type VideoFormat } from "../formats";
import { cancelRenderAction, requestRenderAction } from "../server/actions";
import type { RenderJobsResponse, RenderJobView } from "../types";
import { MotionPreview } from "./motion-preview";

type Parsed =
  | { state: "none" }
  | { state: "invalid"; problems: CompositionProblem[] | null }
  | { state: "motion"; html: string; info: CompositionInfo }
  | { state: "edit"; plan: EditPlan };

function parse(kind: RenderKind, content: string): Parsed {
  if (kind === "motion") {
    const html = extractComposition(content);
    if (!html) return { state: "none" };
    const inspected = inspectComposition(html);
    return inspected.ok ? { state: "motion", html, info: inspected.info } : { state: "invalid", problems: inspected.problems };
  }
  const extracted = extractEditPlan(content);
  if (!extracted.ok) return extracted.problem === "no_plan" ? { state: "none" } : { state: "invalid", problems: null };
  return { state: "edit", plan: extracted.plan };
}

const ACTIVE = (j: RenderJobView) => j.status === "queued" || j.status === "running";
const ERRORS = ["invalid_composition", "invalid_plan", "clip_unreadable", "render_timeout", "worker_lost"] as const;
const STAGES = ["starting", "preparing", "rendering", "capturing", "encoding", "assembling", "uploading", "done"] as const;
const known = <T extends string>(list: readonly T[], value: string | null): value is T => value !== null && (list as readonly string[]).includes(value);

/**
 * Below a Motion Design or Video Editor answer: the preview (motion), the formats (edit), the cost in
 * video credits, the button that asks the worker for the MP4s, then each render's progress and result.
 */
export function RenderPanel({
  messageId,
  kind,
  content,
  attachments,
}: {
  messageId: string;
  kind: RenderKind;
  content: string;
  attachments: { id: string; filename: string; kind: AttachmentKind }[];
}) {
  const t = useTranslations("render");
  const tErrors = useTranslations("errors");
  const parsed = React.useMemo(() => parse(kind, content), [kind, content]);
  const [data, setData] = React.useState<RenderJobsResponse | null>(null);
  const [chosen, setChosen] = React.useState<VideoFormat[] | null>(null);
  const [requesting, startRequesting] = React.useTransition();

  const load = React.useCallback(async (): Promise<RenderJobsResponse | null> => {
    const response = await fetch(`/api/render-jobs?message=${messageId}`, { cache: "no-store" }).catch(() => null);
    return response?.ok ? ((await response.json()) as RenderJobsResponse) : null;
  }, [messageId]);
  const refresh = React.useCallback(async () => {
    const next = await load();
    if (next) setData(next);
  }, [load]);
  const shown = parsed.state !== "none";
  // The renders and credits when the answer is shown, then every 2 seconds while a render is under way.
  React.useEffect(() => {
    if (!shown) return;
    let alive = true;
    void load().then((next) => alive && next && setData(next));
    return () => {
      alive = false;
    };
  }, [shown, load]);
  const active = Boolean(data?.jobs.some(ACTIVE));
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  // The latest image with each name the composition uses (same rule as the server).
  const assetIds = React.useMemo(() => {
    const ids: Record<string, string> = {};
    for (const a of attachments) if (a.kind === "image") ids[a.filename] = a.id;
    return ids;
  }, [attachments]);

  if (parsed.state === "none") return null;
  if (parsed.state === "invalid") {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft/60 px-3 py-2.5 text-[13px]">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          {parsed.problems ? parsed.problems.map((p) => t(`problems.${p}`)).join(" ") : t("planInvalid")} {parsed.problems ? t("problems.fix") : null}
        </span>
      </div>
    );
  }

  const formats: VideoFormat[] = parsed.state === "motion" ? [parsed.info.format] : (chosen ?? parsed.plan.formats);
  const duration = parsed.state === "motion" ? parsed.info.duration : planDuration(parsed.plan);
  const rate = data?.rates[kind];
  const credits = rate === undefined ? null : renderCredits(rate, duration, formats.length);
  const left = data?.creditsLeft ?? 0;
  const enough = credits !== null && credits <= left;
  // Soft warning at 80 % of the month's video credits, hard stop at 100 % (CLAUDE.md §5).
  const almostOut = Boolean(data && data.creditsLimit > 0 && (data.creditsLimit - left) / data.creditsLimit >= 0.8);
  const sameRunning = data?.jobs.some((j) => ACTIVE(j) && j.formats.length === formats.length && j.formats.every((f) => formats.includes(f)));

  const make = () =>
    startRequesting(async () => {
      const result = await requestRenderAction({ messageId, formats: parsed.state === "edit" ? formats : undefined });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("requested"));
      await refresh();
    });

  return (
    <section className="space-y-3" aria-label={t(formats.length > 1 ? "makeMany" : "make")}>
      {parsed.state === "motion" ? <MotionPreview html={parsed.html} info={parsed.info} assetIds={assetIds} /> : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2.5">
        {parsed.state === "edit" ? (
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <legend className="sr-only">{t("formats")}</legend>
            {FORMAT_KEYS.map((f) => {
              const on = formats.includes(f);
              return (
                <label key={f} className="inline-flex items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(value) => setChosen(value === true ? FORMAT_KEYS.filter((k) => k === f || formats.includes(k)) : formats.filter((k) => k !== f))}
                  />
                  {t(`format.${f}`)}
                </label>
              );
            })}
          </fieldset>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {credits !== null ? (
            <span className={enough ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
              {enough ? t("cost", { credits, left }) : t("notEnough", { credits, left })}
            </span>
          ) : null}
          <Button variant="brand" size="sm" disabled={!data || !enough || formats.length === 0 || requesting || sameRunning} onClick={make}>
            {requesting ? <Spinner /> : <ClapperboardIcon />}
            {t(formats.length > 1 ? "makeMany" : "make")}
          </Button>
        </div>
      </div>

      {almostOut && enough ? <p className="text-xs text-warning">{t("almostOut")}</p> : null}
      {data?.jobs.length ? (
        <ul className="space-y-2">
          {data.jobs.map((job) => (
            <JobRow key={job.id} job={job} onRetry={make} onChanged={refresh} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function JobRow({ job, onRetry, onChanged }: { job: RenderJobView; onRetry: () => void; onChanged: () => Promise<void> }) {
  const t = useTranslations("render");
  const tErrors = useTranslations("errors");
  const [cancelling, startCancelling] = React.useTransition();
  const progress = Math.round(job.progress);
  const running = ACTIVE(job);
  const error = known(ERRORS, job.errorCode) ? job.errorCode : "default";

  return (
    <li className="space-y-2 rounded-lg border bg-card px-3 py-2.5" data-testid="render-job" data-status={job.status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        {running ? (
          <Loader2Icon className="size-4 animate-spin text-brand" />
        ) : job.status === "succeeded" ? (
          <CheckCircle2Icon className="size-4 text-success" />
        ) : (
          <AlertCircleIcon className={job.status === "failed" ? "size-4 text-destructive" : "size-4 text-muted-foreground"} />
        )}
        <span className="font-medium">{t(`status.${job.status}`, { progress })}</span>
        {job.status === "running" && known(STAGES, job.stage) ? <span className="text-muted-foreground">{t(`stage.${job.stage}`)}</span> : null}
        <span className="text-xs text-muted-foreground">{job.formats.map((f) => t(`format.${f}`)).join(" · ")}</span>
        {job.mine && running ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={cancelling}
            onClick={() =>
              startCancelling(async () => {
                const result = await cancelRenderAction({ jobId: job.id });
                if (!result.ok) toast.error(tErrors(result.error));
                else toast.success(t("cancelled"));
                await onChanged();
              })
            }
          >
            <XIcon />
            {t("cancel")}
          </Button>
        ) : null}
      </div>
      {running ? (
        <div
          role="progressbar"
          aria-label={t(`status.${job.status}`, { progress })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.max(progress, job.status === "queued" ? 2 : 4)}%` }} />
        </div>
      ) : null}
      {job.status === "succeeded" ? (
        <>
          <div className="flex flex-wrap items-start gap-3">
            {job.outputs.map((o) => (
              <figure key={o.format} className="space-y-1.5" style={{ width: o.width >= o.height ? 320 : 160 }}>
                <video
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={t("videoLabel", { format: t(`format.${o.format}`) })}
                  src={`/api/render-jobs/${job.id}/video?format=${encodeURIComponent(o.format)}`}
                  className="w-full rounded-md border bg-black"
                  style={{ aspectRatio: `${o.width} / ${o.height}` }}
                />
                <figcaption>
                  <a
                    href={`/api/render-jobs/${job.id}/video?format=${encodeURIComponent(o.format)}&download=1`}
                    className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
                    aria-label={t("downloadFormat", { format: t(`format.${o.format}`) })}
                  >
                    <DownloadIcon className="size-3.5" />
                    {t("download")} · {o.format}
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
          {job.creditsCharged !== null ? <p className="text-xs text-muted-foreground">{t("charged", { credits: job.creditsCharged })}</p> : null}
        </>
      ) : null}
      {job.status === "failed" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span className="text-destructive">{t(`errors.${error}`)}</span>
          {job.mine ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcwIcon />
              {t("retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
