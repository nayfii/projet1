"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowUpIcon, Loader2Icon, MicIcon, SquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DICTATION_ERRORS, DICTATION_MAX_SECONDS, type DictationError } from "../files";

type Phase = "idle" | "recording" | "transcribing";

const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const BARS = 36;

function formatElapsed(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Voice dictation (CLAUDE.md §11), like ChatGPT's: the microphone in the message box; while
 * recording, a bar with the voice level, the time, Cancel, Stop (the text lands in the message box
 * to be read and edited, never sent) and Send (transcribed, then sent at once). The recording keeps
 * going when the person switches tab, window or application (the browser keeps the microphone; the
 * tab's title shows that it is on); closing the tab or leaving this conversation stops it.
 * Hide masks the text before any chat model, like anything typed. The audio reaches OpenAI unmasked
 * for transcription (docs/SECURITY.md).
 */
export function DictationButton({
  disabled,
  onText,
  onSend,
  onRecordingChange,
}: {
  disabled?: boolean;
  /** Stop: the text goes into the message box, for review. */
  onText: (text: string) => void;
  /** Send arrow: the text is sent right away. */
  onSend?: (text: string) => void;
  /** The input's toolbar gives the whole line to the recording bar while it records. */
  onRecordingChange?: (recording: boolean) => void;
}) {
  const t = useTranslations("dictation");
  const locale = useLocale();
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [elapsed, setElapsed] = React.useState(0);
  const recorder = React.useRef<MediaRecorder | null>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const audio = React.useRef<AudioContext | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const startedAt = React.useRef(0);
  // What to do once the recorder has stopped: drop it, put the text in the box, or send it.
  const outcome = React.useRef<"cancel" | "review" | "send">("review");
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const frame = React.useRef(0);
  const title = React.useRef<string | null>(null);

  const release = React.useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audio.current?.close().catch(() => {});
    audio.current = null;
    recorder.current = null;
    if (title.current !== null) document.title = title.current;
    title.current = null;
  }, []);

  React.useEffect(
    () => () => {
      outcome.current = "cancel";
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    },
    [release],
  );

  const fail = (code: DictationError | "unsupported" | "denied" | "network") => toast.error(t(`errors.${code}`));

  async function transcribe(blob: Blob, seconds: number, then: "review" | "send") {
    setPhase("transcribing");
    const form = new FormData();
    form.append("audio", blob, `dictation.${blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm"}`);
    form.append("seconds", String(Math.round(seconds * 10) / 10));
    form.append("locale", locale === "en" ? "en" : "fr");
    const response = await fetch("/api/dictation", { method: "POST", body: form }).catch(() => null);
    setPhase("idle");
    if (!response) return fail("network");
    const body = (await response.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
    if (response.ok && body?.ok && body.text) return then === "send" && onSend ? onSend(body.text) : onText(body.text);
    const code = (DICTATION_ERRORS as readonly string[]).includes(body?.error ?? "") ? (body!.error as DictationError) : "failed";
    fail(code);
  }

  /** The voice level, drawn as a rolling bar graph (a still graph when motion is reduced). */
  function meter(source: MediaStream) {
    try {
      const context = new AudioContext();
      audio.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(source).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const levels: number[] = Array(BARS).fill(0);
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let last = 0;
      const draw = (now: number) => {
        frame.current = requestAnimationFrame(draw);
        if (now - last < (still ? 250 : 60)) return;
        last = now;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        const rms = Math.min(1, Math.sqrt(sum / data.length) * 4);
        levels.shift();
        levels.push(rms);
        const el = canvas.current;
        const ctx = el?.getContext("2d");
        if (!el || !ctx) return;
        const ratio = window.devicePixelRatio || 1;
        const width = el.clientWidth * ratio;
        const height = el.clientHeight * ratio;
        if (el.width !== width) el.width = width;
        if (el.height !== height) el.height = height;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = getComputedStyle(el).color;
        const step = width / BARS;
        levels.forEach((level, i) => {
          const h = Math.max(2 * ratio, level * height);
          ctx.globalAlpha = 0.35 + 0.65 * (i / BARS);
          ctx.beginPath();
          ctx.roundRect(i * step + step * 0.25, (height - h) / 2, step * 0.5, h, step * 0.25);
          ctx.fill();
        });
      };
      frame.current = requestAnimationFrame(draw);
    } catch {
      // No level meter (old browser): recording still works.
    }
  }

  async function start() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return fail("unsupported");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return fail("denied");
    }
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    recorder.current = rec;
    chunks.current = [];
    outcome.current = "review";
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      const then = outcome.current;
      release();
      onRecordingChange?.(false);
      if (then === "cancel") return setPhase("idle");
      if (seconds < 0.6 || blob.size === 0) {
        setPhase("idle");
        return toast(t("tooShort"));
      }
      void transcribe(blob, seconds, then);
    };
    startedAt.current = Date.now();
    setElapsed(0);
    rec.start(250);
    setPhase("recording");
    onRecordingChange?.(true);
    meter(stream.current);
    // The tab says the microphone is on, for when the person is in another tab or window.
    title.current = document.title;
    document.title = `● ${t("recordingTitle")} · ${title.current}`;
    timer.current = setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      // Long recordings stop on their own at the limit, and land in the box for review.
      if (seconds >= DICTATION_MAX_SECONDS && recorder.current?.state === "recording") recorder.current.stop();
    }, 250);
  }

  const finish = (how: "cancel" | "review" | "send") => {
    outcome.current = how;
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  if (phase === "recording") {
    return (
      <div
        data-dictation=""
        className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-muted/70 pl-1 pr-1 text-[13px] animate-message-in"
        role="status"
        aria-live="polite"
        aria-label={t("recording")}
        data-testid="dictation-bar"
        onKeyDown={(e) => {
          if (e.key === "Escape") finish("cancel");
        }}
      >
        <Tooltip content={t("cancel")}>
          <Button variant="ghost" size="icon-sm" className="size-7 shrink-0 rounded-full" aria-label={t("cancel")} onClick={() => finish("cancel")}>
            <XIcon />
          </Button>
        </Tooltip>
        <span className="relative ml-1 flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-destructive" />
        </span>
        <canvas ref={canvas} aria-hidden className="h-6 min-w-0 flex-1 text-foreground/70" />
        <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</span>
        <Tooltip content={t("stop")}>
          <Button variant="secondary" size="icon-sm" className="size-7 shrink-0 rounded-full" aria-label={t("stop")} autoFocus onClick={() => finish("review")}>
            <SquareIcon className="size-3 fill-current" />
          </Button>
        </Tooltip>
        {onSend ? (
          <Tooltip content={t("send")}>
            <Button size="icon-sm" className="size-7 shrink-0 rounded-full" aria-label={t("send")} onClick={() => finish("send")}>
              <ArrowUpIcon />
            </Button>
          </Tooltip>
        ) : null}
      </div>
    );
  }

  return (
    <Tooltip content={phase === "transcribing" ? t("transcribing") : t("start")}>
      <Button
        data-dictation=""
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
