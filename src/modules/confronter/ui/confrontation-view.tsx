"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangleIcon, CheckCircle2Icon, CheckIcon, GitForkIcon, ScaleIcon, SearchCheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/modules/conversations/ui/markdown";
import { ModelName } from "@/modules/conversations/ui/provider-mark";
import { AssistantAvatar } from "@/modules/avatars/ui/assistant-avatar";
import type { AssistantState } from "@/modules/avatars/assistants";
import { modelDisplay } from "@/modules/providers/catalog";
import type { Confrontation, ConfrontationModel, ConfrontationProgress } from "../types";

type Tab = "synthesis" | "answers" | "critiques";

/**
 * A confrontation in the conversation: progress while the models work, then the synthesis
 * (agreements, divergences, errors, claims to verify, recommended answer), the answers and the critiques.
 */
export function ConfrontationView({
  confrontation,
  progress,
  running,
  failed,
  onCite,
}: {
  confrontation: Confrontation;
  /** Live progress (this browser). */
  progress: ConfrontationProgress | undefined;
  running: boolean;
  failed: boolean;
  onCite?: (position: number) => void;
}) {
  const t = useTranslations("confronter");
  const format = useFormatter();
  const [tab, setTab] = React.useState<Tab>("synthesis");
  const brand = (m: ConfrontationModel) => modelDisplay(m.provider, m.label).brand;
  const model = (id: string) => confrontation.models.find((m) => m.id === id) ?? confrontation.judge;
  const s = confrontation.synthesis;

  return (
    <section aria-label={t("title")} className="overflow-hidden glass-standard rounded-xl border">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <ScaleIcon className="size-4 text-brand" />
          {t("title")}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {confrontation.models.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1.5">
              <AssistantAvatar provider={m.provider} size={20} />
              {brand(m)}
            </span>
          ))}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{t("judge", { model: brand(confrontation.judge) })}</span>
        {confrontation.questionExcerpt ? (
          <p className="basis-full truncate text-xs text-muted-foreground">{`« ${confrontation.questionExcerpt} »`}</p>
        ) : null}
      </header>

      {running ? (
        <Progress confrontation={confrontation} progress={progress ?? []} />
      ) : (
        <>
          <div role="tablist" aria-label={t("title")} className="flex gap-1 border-b px-2 pt-2">
            {(["synthesis", "answers", "critiques"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-[13px] transition-colors",
                  tab === key ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "synthesis" ? t("tabSynthesis") : key === "answers" ? t("tabAnswers", { count: confrontation.answers.length }) : t("tabCritiques", { count: confrontation.critiques.length })}
              </button>
            ))}
          </div>

          <div role="tabpanel" className="space-y-4 px-4 py-4">
            {tab === "synthesis" ? (
              s ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Findings icon={CheckCircle2Icon} tone="text-success" title={t("agreements")} items={s.agreements} empty={t("none")} />
                    <Findings icon={GitForkIcon} tone="text-brand" title={t("divergences")} items={s.divergences} empty={t("none")} />
                    <Findings icon={AlertTriangleIcon} tone="text-destructive" title={t("errors")} items={s.errors} empty={t("none")} />
                    <Findings icon={SearchCheckIcon} tone="text-warning" title={t("toVerify")} items={s.toVerify} empty={t("none")} />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-[13px] font-medium text-muted-foreground">{t("recommended")}</h3>
                    <Markdown onCite={onCite}>{s.recommended}</Markdown>
                  </div>
                </>
              ) : (
                <p role="alert" className="rounded-lg bg-destructive-soft/60 px-3 py-2 text-sm">
                  {failed ? t("failed") : t("stopped")}
                </p>
              )
            ) : null}
            {tab === "answers"
              ? confrontation.answers.map((a) => (
                  <Part
                    key={a.modelId}
                    title={
                      <span className="inline-flex items-center gap-2">
                        <AssistantAvatar provider={model(a.modelId).provider} size={24} />
                        <ModelName provider={model(a.modelId).provider} label={model(a.modelId).label} dot={false} />
                      </span>
                    }
                    failed={a.status === "error"}
                    failedLabel={t("noAnswer")}
                  >
                    {a.content}
                  </Part>
                ))
              : null}
            {tab === "critiques"
              ? confrontation.critiques.length === 0
                ? <p className="text-[13px] text-muted-foreground">{t("noCritiques")}</p>
                : confrontation.critiques.map((c) => (
                    <Part
                      key={c.modelId}
                      title={
                        <span className="inline-flex items-center gap-2">
                          <AssistantAvatar provider={model(c.modelId).provider} size={24} />
                          {t("critiqueBy", { model: brand(model(c.modelId)) })}
                        </span>
                      }
                      failed={c.status === "error"}
                      failedLabel={t("noCritique")}
                    >
                      {c.content}
                    </Part>
                  ))
              : null}
          </div>
          {confrontation.credits > 0 ? (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("used", { credits: format.number(confrontation.credits, { maximumFractionDigits: 0 }) })}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * While it runs: the assistants around the table. Each one thinks while it writes its answer,
 * talks while it critiques the others, smiles when it is done; then the judge writes the synthesis.
 */
function Progress({ confrontation, progress }: { confrontation: Confrontation; progress: ConfrontationProgress }) {
  const t = useTranslations("confronter");
  const status = (stage: "answer" | "critique" | "synthesis", modelId: string) => progress.find((p) => p.stage === stage && p.modelId === modelId)?.status;
  const seat = (modelId: string): { state: AssistantState; label: string; active: boolean } => {
    const answer = status("answer", modelId);
    const critique = status("critique", modelId);
    if (answer === "error") return { state: "idle", label: t("seatFailed"), active: false };
    if (critique === "running") return { state: "speaking", label: t("seatCritiquing"), active: true };
    if (answer === "running") return { state: "thinking", label: t("seatAnswering"), active: true };
    if (critique === "complete" || critique === "error") return { state: "happy", label: t("seatDone"), active: false };
    if (answer === "complete") return { state: "idle", label: t("seatWaiting"), active: false };
    return { state: "idle", label: t("seatWaiting"), active: false };
  };
  const synthesis = status("synthesis", confrontation.judge.id);
  return (
    <div className="space-y-6 px-4 py-6" aria-live="polite">
      <div className="flex flex-wrap items-start justify-center gap-8 sm:gap-12">
        {confrontation.models.map((m) => {
          const s = seat(m.id);
          return (
            <div key={m.id} className="flex w-28 flex-col items-center gap-2 text-center">
              <AssistantAvatar provider={m.provider} size={64} state={s.state} animated={s.active || s.state === "happy"} seed={m.id} className={cn("transition-transform duration-500", !s.active && "scale-[0.8125]")} />
              <span className="text-[13px] font-medium">{modelDisplay(m.provider, m.label).brand}</span>
              <span className={cn("text-xs", s.active ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <AssistantAvatar
          provider={confrontation.judge.provider}
          size={24}
          state={synthesis === "running" ? "speaking" : "idle"}
          animated={synthesis === "running"}
          seed="judge"
        />
        <span className={cn(synthesis === "running" && "text-shimmer font-medium")}>
          {t("progressSynthesis", { model: modelDisplay(confrontation.judge.provider, confrontation.judge.label).brand })}
        </span>
        {synthesis === "complete" ? <CheckIcon className="size-3.5 text-success" /> : synthesis === "error" ? <XIcon className="size-3.5 text-destructive" /> : null}
      </div>
    </div>
  );
}

function Findings({ icon: Icon, tone, title, items, empty }: { icon: React.ComponentType<{ className?: string }>; tone: string; title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border bg-background/60 px-3 py-2.5">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
        <Icon className={cn("size-4", tone)} />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Part({ title, failed, failedLabel, children }: { title: React.ReactNode; failed: boolean; failedLabel: string; children: string }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[13px] font-medium">{title}</h3>
      {failed ? <p className="text-[13px] text-muted-foreground">{failedLabel}</p> : <Markdown>{children}</Markdown>}
    </div>
  );
}
