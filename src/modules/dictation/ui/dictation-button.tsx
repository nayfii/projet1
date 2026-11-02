"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2Icon, MicIcon, SquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DICTATION_ERRORS, DICTATION_MAX_SECONDS, type DictationError } from "../files";

type Phase = "idle" | "recording" | "transcribing";

const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function formatElapsed(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Voice dictation (CLAUDE.md §11): click to speak, click again to stop. The text lands in the message
 * box, where the person reads it before sending; Hide masks it then like anything typed.
 */
export function DictationButton({ disabled, onText }: { disabled?: boolean; onText: (text: string) => void }) {
  const t = useTranslations("dictation");
  const locale = useLocale();
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [elapsed, setElapsed] = React.useState(0);
  const recorder = React.useRef<MediaRecorder | null>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const startedAt = React.useRef(0);
  const cancelled = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const release = React.useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  React.useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    },
    [release],
  );

  const fail = (code: DictationError | "unsupported" | "denied" | "network") => toast.error(t(`errors.${code}`));

  async function send(blob: Blob, seconds: number) {
    setPhase("transcribing");
    const form = new FormData();
    form.append("audio", blob, `dictation.${blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm"}`);
    form.append("seconds", String(Math.round(seconds * 10) / 10));
    form.append("locale", locale === "en" ? "en" : "fr");
    const response = await fetch("/api/dictation", { method: "POST", body: form }).catch(() => null);
    setPhase("idle");
    if (!response) return fail("network");
    const body = (await response.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
    if (response.ok && body?.ok && body.text) return onText(body.text);
    const code = (DICTATION_ERRORS as readonly string[]).includes(body?.error ?? "") ? (body!.error as DictationError) : "failed";
    fail(code);
  }

  async function start() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return fail("unsupported");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return fail("denied");
    }
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    recorder.current = rec;
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      release();
      if (cancelled.current) return setPhase("idle");
      if (seconds < 0.6 || blob.size === 0) {
        setPhase("idle");
        return toast(t("tooShort"));
      }
      void send(blob, seconds);
    };
    startedAt.current = Date.now();
    setElapsed(0);
    rec.start(250);
    setPhase("recording");
    timer.current = setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      // Long recordings stop on their own at the limit, and are transcribed.
      if (seconds >= DICTATION_MAX_SECONDS && recorder.current?.state === "recording") recorder.current.stop();
    }, 200);
  }

  const stop = (discard: boolean) => {
    cancelled.current = discard;
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  if (phase === "recording") {
    return (
      <div
        className="flex h-8 items-center gap-1 rounded-full bg-destructive/12 pl-2.5 pr-1 text-[13px] text-foreground"
        role="status"
        aria-live="polite"
        onKeyDown={(e) => {
          if (e.key === "Escape") stop(true);
        }}
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-destructive" />
        </span>
        <span className="min-w-9 tabular-nums" aria-label={t("recording")}>
          {formatElapsed(elapsed)}
        </span>
        <Tooltip content={t("cancel")}>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label={t("cancel")} onClick={() => stop(true)}>
            <XIcon />
          </Button>
        </Tooltip>
        <Tooltip content={t("stop")}>
          <Button variant="secondary" size="icon-sm" className="size-7 rounded-full" aria-label={t("stop")} autoFocus onClick={() => stop(false)}>
            <SquareIcon className="size-3 fill-current" />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <Tooltip content={phase === "transcribing" ? t("transcribing") : t("start")}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={phase === "transcribing" ? t("transcribing") : t("start")}
        aria-busy={phase === "transcribing"}
        disabled={disabled || phase === "transcribing"}
        onClick={() => void start()}
        className={cn(phase === "transcribing" && "text-muted-foreground")}
      >
        {phase === "transcribing" ? <Loader2Icon className="animate-spin" /> : <MicIcon />}
      </Button>
    </Tooltip>
  );
}
