"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { memoryLabel } from "../labels";
import type { MemoryKind } from "../types";
import { BrainIcon, CheckIcon, ChevronDownIcon, Loader2Icon, PencilIcon, RotateCcwIcon, ShieldOffIcon, SparklesIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LearningState, MemoryTrace } from "../types";
import {
  correctFactAction,
  forgetLearningAction,
  learnedFactsAction,
  learningStatusAction,
  retryLearningAction,
  usedMemoryAction,
  type LearnedFact,
  type ProposedFact,
  type UsedMemory,
} from "../server/consciousness-actions";
import { decideSuggestionAction } from "../server/actions";

/**
 * Under an answer: what it used from memory and what it taught it (Cendr Consciousness). Every
 * number shown comes from the server's trace of that answer: "3 memories used" means three were
 * given to the model; "2 facts learned" means two were saved. Nothing is shown when nothing happened.
 */
export function MemoryLine({
  messageId,
  memory,
  learning,
  onLearning,
}: {
  messageId: string;
  memory: MemoryTrace | null | undefined;
  learning: LearningState | null | undefined;
  onLearning: (state: LearningState) => void;
}) {
  const t = useTranslations("consciousness");
  const [open, setOpen] = React.useState<"used" | "learned" | null>(null);
  const used = (memory?.used.length ?? 0) + (memory?.recent ?? 0);
  const blocked = memory?.blocked.length ?? 0;

  // While the learning runs, its state is read again every 1.5 s (40 s at most).
  const running = Boolean(learning && (learning.status === "queued" || learning.status === "running"));
  const report = React.useRef(onLearning);
  React.useEffect(() => {
    report.current = onLearning;
  });
  const jobId = learning?.jobId;
  const status = learning?.status;
  React.useEffect(() => {
    if (!running || !jobId) return;
    let stopped = false;
    let tries = 0;
    let timer = 0;
    const tick = async () => {
      if (stopped || tries++ > 26) return;
      const next = await learningStatusAction({ jobId });
      if (stopped) return;
      if (next && next.status !== status) return report.current(next);
      timer = window.setTimeout(tick, 1500);
    };
    timer = window.setTimeout(tick, 1200);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [running, jobId, status]);

  const learnedVisible = learning && !learning.forgotten && (running || learning.status === "failed" || learning.learned > 0 || learning.proposed > 0);
  if (used === 0 && blocked === 0 && !learnedVisible) return null;

  return (
    <div className="space-y-2" data-testid="memory-line">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {used > 0 ? (
          <Chip active={open === "used"} onClick={() => setOpen(open === "used" ? null : "used")} testId="memory-used">
            <BrainIcon className="size-3.5 text-brand" />
            {t("used", { count: used })}
            <ChevronDownIcon className={cn("size-3 transition-transform", open === "used" && "rotate-180")} />
          </Chip>
        ) : null}
        {blocked > 0 && used === 0 ? (
          <Chip active={open === "used"} onClick={() => setOpen(open === "used" ? null : "used")} testId="memory-blocked">
            <ShieldOffIcon className="size-3.5" />
            {t("blockedShort")}
          </Chip>
        ) : null}
        {learnedVisible && learning ? (
          running ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-muted-foreground" data-testid="memory-learning" role="status">
              <Loader2Icon className="size-3.5 animate-spin" />
              {t("learning")}
            </span>
          ) : learning.status === "failed" ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="memory-learning-failed">
              {t("learningFailed")}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs"
                onClick={async () => {
                  const next = await retryLearningAction({ jobId: learning.jobId });
                  if (next) onLearning(next);
                }}
              >
                <RotateCcwIcon className="size-3" />
                {t("retry")}
              </Button>
            </span>
          ) : (
            <Chip active={open === "learned"} onClick={() => setOpen(open === "learned" ? null : "learned")} testId="memory-learned">
              <SparklesIcon className="size-3.5 text-brand" />
              {learning.learned > 0 ? t("learned", { count: learning.learned }) : null}
              {learning.learned > 0 && learning.proposed > 0 ? " · " : null}
              {learning.proposed > 0 ? t("toConfirm", { count: learning.proposed }) : null}
              <ChevronDownIcon className={cn("size-3 transition-transform", open === "learned" && "rotate-180")} />
            </Chip>
          )
        ) : null}
      </div>
      {open === "used" ? <UsedPanel messageId={messageId} /> : null}
      {open === "learned" && learning ? <LearnedPanel learning={learning} onLearning={onLearning} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const panel = "rounded-xl border bg-card/60 px-3.5 py-3 text-[13px] animate-message-in";

function UsedPanel({ messageId }: { messageId: string }) {
  const t = useTranslations("consciousness");
  const [data, setData] = React.useState<Awaited<ReturnType<typeof usedMemoryAction>> | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    void usedMemoryAction({ messageId }).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [messageId]);
  if (data === undefined) return <p className={cn(panel, "text-muted-foreground")}>{t("loading")}</p>;
  if (!data) return null;
  const groups: { reason: UsedMemory["reason"]; items: UsedMemory[] }[] = [
    { reason: "brief", items: data.items.filter((i) => i.reason === "brief") },
    { reason: "search", items: data.items.filter((i) => i.reason === "search") },
  ];
  return (
    <div className={cn(panel, "space-y-3")} data-testid="memory-used-panel">
      <p className="text-muted-foreground">{t("whyIntro")}</p>
      {groups.map((g) =>
        g.items.length ? (
          <div key={g.reason} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t(`reason.${g.reason}`)}</p>
            <ul className="space-y-1.5">
              {g.items.map((i) => (
                <li key={i.id}>
                  <Link href={i.href} className="group block rounded-lg px-2 py-1.5 transition-colors hover:bg-muted">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{i.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {memoryLabel(i.where.kind, i.where.clientName, t)}
                        {i.date ? ` · ${new Date(i.date).toLocaleDateString()}` : ""}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-muted-foreground">{i.excerpt}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {data.recent > 0 ? <p className="text-muted-foreground">{t("recentUsed", { count: data.recent })}</p> : null}
      {data.pending > 0 ? <p className="text-muted-foreground">{t("pendingNotice")}</p> : null}
      {data.blocked.map((b, i) => (
        <p key={i} className="flex items-start gap-1.5 text-muted-foreground">
          <ShieldOffIcon className="mt-0.5 size-3.5 shrink-0" />
          {t("blocked", { memory: memoryLabel(b.kind as MemoryKind, b.clientName, t) })}
        </p>
      ))}
    </div>
  );
}

function LearnedPanel({ learning, onLearning, onClose }: { learning: LearningState; onLearning: (s: LearningState) => void; onClose: () => void }) {
  const t = useTranslations("consciousness");
  const tErrors = useTranslations("errors");
  const [data, setData] = React.useState<Awaited<ReturnType<typeof learnedFactsAction>> | undefined>(undefined);
  const load = React.useCallback(() => learnedFactsAction({ jobId: learning.jobId }).then(setData), [learning.jobId]);
  React.useEffect(() => {
    void load();
  }, [load]);
  if (data === undefined) return <p className={cn(panel, "text-muted-foreground")}>{t("loading")}</p>;
  if (!data) return null;
  const facts = data.facts.filter((f) => f.status === "active");
  return (
    <div className={cn(panel, "space-y-3")} data-testid="memory-learned-panel">
      {facts.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("learnedFor", { client: data.clientName ?? "" })}</p>
          <ul className="space-y-1">
            {facts.map((f) => (
              <FactRow key={f.id} fact={f} onChanged={load} />
            ))}
          </ul>
        </div>
      ) : null}
      {data.proposed.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("confirmIntro")}</p>
          <ul className="space-y-1">
            {data.proposed.map((p) => (
              <ProposalRow key={p.id} proposal={p} onDecided={load} />
            ))}
          </ul>
        </div>
      ) : null}
      {learning.keptPrivate > 0 ? <p className="text-xs text-muted-foreground">{t("keptPrivate", { count: learning.keptPrivate })}</p> : null}
      {facts.length > 0 && facts.some((f) => f.canWrite) ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={async () => {
            const result = await forgetLearningAction({ jobId: learning.jobId });
            if (!result.ok) return void toast.error(tErrors(result.error));
            toast.success(t("forgotten"));
            onLearning({ ...learning, forgotten: true });
            onClose();
          }}
        >
          <XIcon className="size-3.5" />
          {t("forget")}
        </Button>
      ) : null}
    </div>
  );
}

function FactRow({ fact, onChanged }: { fact: LearnedFact; onChanged: () => void }) {
  const t = useTranslations("consciousness");
  const tErrors = useTranslations("errors");
  const [editing, setEditing] = React.useState(false);
  const [content, setContent] = React.useState(fact.content);
  if (editing) {
    return (
      <li className="flex items-center gap-1.5">
        <Input value={content} onChange={(e) => setContent(e.target.value)} className="h-8 text-[13px]" aria-label={t("correct")} autoFocus />
        <Button
          size="sm"
          className="h-8"
          onClick={async () => {
            const result = await correctFactAction({ entryId: fact.id, title: fact.title, content });
            if (!result.ok) return void toast.error(tErrors(result.error));
            toast.success(t("corrected"));
            setEditing(false);
            onChanged();
          }}
        >
          {t("save")}
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>
          {t("cancel")}
        </Button>
      </li>
    );
  }
  return (
    <li className="group/fact flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
      <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        <span>{fact.content}</span>
        {fact.replaced ? <span className="block text-xs text-muted-foreground line-through">{fact.replaced}</span> : null}
      </span>
      {fact.canWrite ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/fact:opacity-100"
          aria-label={t("correct")}
        >
          <PencilIcon className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}

function ProposalRow({ proposal, onDecided }: { proposal: ProposedFact; onDecided: () => void }) {
  const t = useTranslations("consciousness");
  const tErrors = useTranslations("errors");
  const decide = async (approve: boolean) => {
    const result = await decideSuggestionAction({ suggestionId: proposal.id, approve });
    if (!result.ok) return void toast.error(tErrors(result.error));
    toast.success(approve ? t("confirmed") : t("dismissed"));
    onDecided();
  };
  return (
    <li className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
      <span className="min-w-0 flex-1">
        {proposal.content}
        {proposal.reason ? <span className="block text-xs text-muted-foreground">{t(`proposalReason.${proposal.reason as "assistant_claim" | "uncertain" | "conflict"}`)}</span> : null}
      </span>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void decide(true)}>
        {t("confirm")}
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void decide(false)}>
        {t("dismiss")}
      </Button>
    </li>
  );
}
