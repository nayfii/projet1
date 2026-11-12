"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowUpIcon, Loader2Icon, MicIcon, SquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isPhantomTranscript, joinSegments, tidyDictation } from "../cleanup";
import { DICTATION_CONTEXT_CHARS, DICTATION_ERRORS, DICTATION_MAX_SECONDS, type DictationError } from "../files";
import { isSilent, newCutter, rmsLevel, SEGMENT_RULES, shouldCut, type Cutter } from "../segments";
import { markDictation } from "../timing";

type Phase = "idle" | "starting" | "recording" | "transcribing" | "cleaning";
type Outcome = "cancel" | "review" | "send";
type Problem = DictationError | "unsupported" | "denied" | "noDevice" | "network";

const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const BARS = 36;
/** Voice level sampling (also drives the bar graph). */
const TICK_MS = 60;
/** A shortcut held at least this long is push-to-talk; a quick press leaves the microphone on. */
const HOLD_MS = 400;
/** Errors after which the rest of the recording cannot be transcribed either. */
const FATAL: readonly DictationError[] = ["quota", "disabled", "forbidden", "not_configured"];
/** One part's transcription gives up after this (a stalled connection never leaves the person waiting). */
const PART_TIMEOUT_MS = 45_000;
/** A second try, after a short wait, when a part fails on the way. */
const RETRY_DELAY_MS = 400;
/** A part waits at most this long for the text of the part before it (the hint for continuity). */
const CONTEXT_WAIT_MS = 600;
/** Sent without being read: the polished text if it comes within this, our own rules otherwise. */
const SEND_POLISH_MS = 2_500;
/** In the box: the polished version replaces the text if it comes within this. */
const REVIEW_POLISH_MS = 12_000;
/** Speech needs little: smaller parts travel faster on a weak connection. */
const AUDIO_BITS_PER_SECOND = 32_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One recording, cut into parts at the speaker's pauses (see segments.ts). */
type Session = {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  cutter: Cutter;
  /** Each part's text: undefined while it is transcribed, null when it said nothing (or was lost). */
  parts: (string | null | undefined)[];
  /** Each part's transcription, started as soon as the part is recorded; they run side by side and the
   * text keeps the order of the parts. */
  done: Promise<void>[];
  /** The last part's recording is complete. */
  lastPart: Promise<unknown>;
  /** Stops the transcriptions still on their way (cancel). */
  abort: AbortController;
  /** The first words were shown. */
  shown: boolean;
  startedAt: number;
  outcome: Outcome | null;
  fatal: DictationError | null;
  lost: boolean;
  /** Started with the keyboard shortcut (focus stays in the message box). */
  viaKey: boolean;
  /** The level meter has heard a voice: only then are silent parts left out. */
  heard: boolean;
};

function formatElapsed(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const subscribeNothing = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function extension(type: string) {
  return type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
}

/**
 * Voice dictation (CLAUDE.md §11), like ChatGPT's or Wispr Flow's: the microphone in the message box;
 * while recording, a bar with the voice level, the time, Cancel, Stop (the text lands in the message
 * box to be read and edited, never sent) and Send (transcribed, then sent at once).
 * - The bar shows at once; the dot turns red when the microphone really listens.
 * - The recording is cut at the speaker's pauses and each part transcribed as soon as it is recorded,
 *   side by side, so the text appears while they talk (`onLive`) and is ready almost as soon as they
 *   stop (docs/DICTATION.md has the measurements).
 * - On Stop the text lands at once, tidied by our own rules; the polished version (punctuation, their
 *   own corrections; /api/dictation/clean) follows and replaces it only if the box is untouched.
 *   "Show the original" puts back what was transcribed (`onReplace`).
 * - With `shortcut`, holding Ctrl + Shift + Space records while held (push-to-talk); a quick press
 *   leaves the microphone on until the shortcut is pressed again.
 * The recording keeps going when the person switches tab, window or application (the tab's title says
 * the microphone is on); closing the tab or leaving this page stops it. Hide masks the text before any
 * chat model, like anything typed. The audio reaches OpenAI unmasked for transcription (docs/SECURITY.md).
 */
export function DictationButton({
  disabled,
  onText,
  onSend,
  onRecordingChange,
  onLive,
  onReplace,
  shortcut,
}: {
  disabled?: boolean;
  /** Stop: the text goes into the message box, for review. */
  onText: (text: string) => void;
  /** Send arrow: the text is sent right away. */
  onSend?: (text: string) => void;
  /** The input's toolbar gives the whole line to the recording bar while it records. */
  onRecordingChange?: (recording: boolean) => void;
  /** What has been transcribed so far, while the person talks ("" once it is delivered or dropped). */
  onLive?: (text: string) => void;
  /**
   * Swap a delivered text for another; false when it is no longer there. `auto` is the polished version
   * arriving on its own: it may only replace the text if the box has not changed at all since the text
   * was delivered (the person's typing and caret are never disturbed). Without it, the person asked
   * ("Show the original").
   */
  onReplace?: (from: string, to: string, auto?: boolean) => boolean;
  /** Push-to-talk with Ctrl + Shift + Space (one microphone per page should have it). */
  shortcut?: boolean;
}) {
  const t = useTranslations("dictation");
  const locale: "fr" | "en" = useLocale() === "en" ? "en" : "fr";
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [elapsed, setElapsed] = React.useState(0);
  const [viaKey, setViaKey] = React.useState(false);
  // The shortcut's name follows the keyboard (⌃ ⇧ on a Mac).
  const mac = React.useSyncExternalStore(subscribeNothing, isMac, () => false);
  const session = React.useRef<Session | null>(null);
  const audio = React.useRef<AudioContext | null>(null);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const title = React.useRef<string | null>(null);
  const hold = React.useRef<{ at: number } | null>(null);
  // The microphone is being opened (the bar already shows); cancelled if the person changes their mind.
  const opening = React.useRef<{ cancelled: boolean } | null>(null);
  // The parent's latest callbacks: the text arrives well after the render that started the recording.
  const parent = React.useRef({ onText, onSend, onRecordingChange, onLive, onReplace });
  React.useEffect(() => {
    parent.current = { onText, onSend, onRecordingChange, onLive, onReplace };
  });

  /** Microphone, level meter, timer and tab title back to normal (the transcription may go on). */
  const releaseDevices = React.useCallback((s: Session | null) => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    s?.stream.getTracks().forEach((track) => track.stop());
    void audio.current?.close().catch(() => {});
    audio.current = null;
    if (title.current !== null) document.title = title.current;
    title.current = null;
  }, []);

  React.useEffect(
    () => () => {
      if (opening.current) opening.current.cancelled = true;
      const s = session.current;
      session.current = null;
      if (s) {
        s.outcome = "cancel";
        s.abort.abort();
        if (s.recorder?.state === "recording") s.recorder.stop();
      }
      releaseDevices(s);
    },
    [releaseDevices],
  );

  const fail = (code: Problem) => toast.error(t(`errors.${code}`));

  const errorCode = (value: unknown): DictationError => ((DICTATION_ERRORS as readonly string[]).includes(String(value)) ? (value as DictationError) : "failed");

  /** What has been transcribed so far, in order, under the message box. */
  function showLive(s: Session) {
    if (session.current !== s) return;
    const live = joinSegments(s.parts.filter((p): p is string => Boolean(p)));
    if (live && !s.shown && !s.outcome) {
      s.shown = true;
      markDictation("first-text");
    }
    parent.current.onLive?.(live);
  }

  function partSignal(s: Session): AbortSignal {
    const timeout = AbortSignal.timeout(PART_TIMEOUT_MS);
    return typeof AbortSignal.any === "function" ? AbortSignal.any([s.abort.signal, timeout]) : timeout;
  }

  /** One part → its text, with what this recording already said as a hint. One retry on a passing failure. */
  async function transcribePart(s: Session, index: number, blob: Blob, seconds: number) {
    // The part just before is usually transcribed by now; it is waited for a moment at most, so a slow
    // part never holds the next ones up (its text is then simply not in the hint).
    if (index > 0 && s.parts[index - 1] === undefined) await Promise.race([s.done[index - 1], delay(CONTEXT_WAIT_MS)]);
    const previous = joinSegments(s.parts.slice(0, index).filter((p): p is string => Boolean(p))).slice(-DICTATION_CONTEXT_CHARS);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (s.outcome === "cancel" || s.fatal) return;
      if (attempt) await delay(RETRY_DELAY_MS);
      const form = new FormData();
      form.append("audio", blob, `dictation.${extension(blob.type)}`);
      form.append("seconds", String(Math.round(seconds * 10) / 10));
      form.append("locale", locale);
      if (previous) form.append("context", previous);
      const response = await fetch("/api/dictation", { method: "POST", body: form, signal: partSignal(s) }).catch(() => null);
      const body = response ? ((await response.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null) : null;
      if (response?.ok && body?.ok && typeof body.text === "string") {
        s.parts[index] = isPhantomTranscript(body.text) ? null : body.text.trim();
        showLive(s);
        return;
      }
      const code = response ? errorCode(body?.error) : null;
      if (code === "empty") {
        s.parts[index] = null;
        return;
      }
      if (code && FATAL.includes(code)) {
        s.parts[index] = null;
        s.fatal = code;
        // Nothing more can be transcribed: the recording stops, what was already written is kept.
        if (!s.outcome) finish("review");
        return;
      }
    }
    s.parts[index] = null;
    if (s.outcome !== "cancel") s.lost = true;
  }

  /** Starts recording a new part on the same microphone; the previous part (if any) is then closed. */
  function startPart(s: Session) {
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const rec = new MediaRecorder(s.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    const chunks: Blob[] = [];
    const index = s.parts.length;
    const cutter = newCutter(performance.now(), index === 0);
    s.parts.push(undefined);
    const ready = new Promise<{ blob: Blob; seconds: number } | null>((resolve) => {
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        const seconds = (performance.now() - cutter.startedAt) / 1000;
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        // Silence (or a click) is not sent: it costs and transcription models invent text on it.
        resolve(blob.size === 0 || seconds < (index === 0 ? 0.6 : 0.3) || (s.heard && isSilent(cutter)) ? null : { blob, seconds });
      };
      rec.onerror = () => resolve(null);
    });
    // Transcribed as soon as it is recorded, without waiting for the parts before it.
    s.done.push(
      ready
        .then((part) => (part ? transcribePart(s, index, part.blob, part.seconds) : void (s.parts[index] = null)))
        .catch(() => {
          s.parts[index] = null;
          s.lost = true;
        }),
    );
    s.lastPart = ready;
    const previous = s.recorder;
    s.recorder = rec;
    s.cutter = cutter;
    rec.start(250);
    if (previous?.state === "recording") previous.stop();
  }

  /** Voice level → bar graph (a still one when motion is reduced) and pauses → a new part. */
  function listen(s: Session) {
    let analyser: AnalyserNode | null = null;
    let data: Uint8Array<ArrayBuffer> | null = null;
    try {
      const context = new AudioContext();
      audio.current = context;
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(s.stream).connect(analyser);
      data = new Uint8Array(analyser.fftSize);
      void context.resume().catch(() => {});
    } catch {
      // No level meter (old browser): one part for the whole recording, transcribed at the end.
    }
    const levels: number[] = Array(BARS).fill(0);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let tick = 0;
    timer.current = setInterval(() => {
      const seconds = (Date.now() - s.startedAt) / 1000;
      setElapsed(Math.floor(seconds));
      // Long recordings stop on their own at the limit, and land in the box for review.
      if (seconds >= DICTATION_MAX_SECONDS) return finish("review");
      if (!analyser || !data) return;
      analyser.getByteTimeDomainData(data);
      const level = rmsLevel(data);
      if (level >= SEGMENT_RULES.silent) s.heard = true;
      if (shouldCut(s.cutter, level, performance.now())) {
        try {
          startPart(s);
        } catch {
          // The browser refused a new recorder: the current part simply goes on.
        }
      }
      levels.shift();
      levels.push(Math.min(1, level * 4));
      if (still && tick++ % 4) return;
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
      levels.forEach((value, i) => {
        const h = Math.max(2 * ratio, value * height);
        ctx.globalAlpha = 0.35 + 0.65 * (i / BARS);
        ctx.beginPath();
        ctx.roundRect(i * step + step * 0.25, (height - h) / 2, step * 0.5, h, step * 0.25);
        ctx.fill();
      });
    }, TICK_MS);
  }

  async function start(via: "click" | "key") {
    if (session.current || opening.current || phase !== "idle" || disabled) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return fail("unsupported");
    markDictation("click");
    // The bar shows at once, while the browser opens the microphone (or asks the first time).
    const opened = { cancelled: false };
    opening.current = opened;
    setViaKey(via === "key");
    setElapsed(0);
    setPhase("starting");
    parent.current.onRecordingChange?.(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      if (opened.cancelled) return;
      opening.current = null;
      setPhase("idle");
      parent.current.onRecordingChange?.(false);
      return fail(error instanceof DOMException && (error.name === "NotFoundError" || error.name === "OverconstrainedError") ? "noDevice" : "denied");
    }
    if (opened.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    opening.current = null;
    const s: Session = {
      stream,
      recorder: null,
      cutter: newCutter(performance.now(), true),
      parts: [],
      done: [],
      lastPart: Promise.resolve(),
      abort: new AbortController(),
      shown: false,
      startedAt: Date.now(),
      outcome: null,
      fatal: null,
      lost: false,
      viaKey: via === "key",
      heard: false,
    };
    session.current = s;
    try {
      startPart(s);
    } catch {
      session.current = null;
      releaseDevices(s);
      setPhase("idle");
      parent.current.onRecordingChange?.(false);
      return fail("unsupported");
    }
    listen(s);
    setPhase("recording");
    markDictation("listening");
    // The tab says the microphone is on, for when the person is in another tab or window.
    title.current = document.title;
    document.title = `● ${t("recordingTitle")} · ${title.current}`;
  }

  /** The polished version (a fast model; see /api/dictation/clean), or null if there is none in time. */
  async function polish(text: string, within: number): Promise<string | null> {
    const response = await fetch("/api/dictation/clean", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, locale }),
      signal: AbortSignal.timeout(within),
    }).catch(() => null);
    const body = response?.ok ? ((await response.json().catch(() => null)) as { ok?: boolean; text?: string; polished?: boolean } | null) : null;
    return body?.ok && body.polished && typeof body.text === "string" && body.text.trim() ? body.text : null;
  }

  function finish(how: Outcome) {
    const s = session.current;
    if (!s) {
      // Still opening the microphone: nothing was recorded, the bar simply goes away.
      if (opening.current) {
        opening.current.cancelled = true;
        opening.current = null;
        hold.current = null;
        setPhase("idle");
        parent.current.onRecordingChange?.(false);
      }
      return;
    }
    if (s.outcome) return;
    s.outcome = how;
    hold.current = null;
    if (s.recorder?.state === "recording") s.recorder.stop();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    parent.current.onRecordingChange?.(false);
    if (how === "cancel") {
      s.abort.abort();
      session.current = null;
      releaseDevices(s);
      parent.current.onLive?.("");
      setPhase("idle");
      return;
    }
    markDictation("stop");
    setPhase("transcribing");
    void s.lastPart.then(() => releaseDevices(s));
    void s.lastPart.then(() => Promise.all(s.done)).then(() => deliver(s));
  }

  /** The session is over: the microphone button is ready for the next dictation. */
  function close(s: Session) {
    if (session.current !== s) return;
    session.current = null;
    parent.current.onLive?.("");
    setPhase("idle");
  }

  async function deliver(s: Session) {
    if (session.current !== s) return;
    const original = joinSegments(s.parts.filter((p): p is string => Boolean(p)));
    if (!original) {
      close(s);
      if (s.fatal) return fail(s.fatal);
      if (s.lost) return fail("failed");
      return (Date.now() - s.startedAt) / 1000 < 1.5 ? void toast(t("tooShort")) : fail("empty");
    }
    // Our own rules at once (hesitations, words said twice, spaces, capitals); see cleanup.ts.
    const tidy = tidyDictation(original, locale);
    // A transcript with a missing part is never sent unread.
    if (s.outcome === "send" && parent.current.onSend && !s.fatal && !s.lost) {
      // Sent without being read: with the person's own corrections applied, if that comes quickly.
      setPhase("cleaning");
      const text = (await polish(original, SEND_POLISH_MS)) ?? tidy;
      if (session.current !== s) return;
      close(s);
      parent.current.onSend?.(text);
      markDictation("text");
      return;
    }
    close(s);
    parent.current.onText(tidy);
    markDictation("text");
    if (s.fatal) return fail(s.fatal);
    if (s.lost) toast.error(t("partLost"));
    if (!parent.current.onReplace) return;
    // The polished version follows; it takes the text's place only if the text is still there as it was
    // delivered (what the person changed meanwhile is theirs).
    const polished = await polish(original, REVIEW_POLISH_MS);
    let shown = tidy;
    if (polished && polished !== tidy && parent.current.onReplace?.(tidy, polished, true)) {
      shown = polished;
      markDictation("polished");
    }
    if (shown === original || s.lost) return;
    toast(t("cleaned"), {
      duration: 6000,
      action: {
        label: t("showOriginal"),
        onClick: () => {
          // The message box as it is now (the person may have typed since).
          if (!parent.current.onReplace?.(shown, original)) toast(t("originalGone"));
        },
      },
    });
  }

  // Push-to-talk: hold Ctrl + Shift + Space anywhere on the page; a quick press keeps the microphone on.
  const onShortcutDown = React.useEffectEvent((e: KeyboardEvent) => {
    const s = session.current;
    if (e.key === "Escape" && ((s && !s.outcome && s.viaKey) || (opening.current && viaKey))) {
      e.preventDefault();
      return finish("cancel");
    }
    if (e.code !== "Space" || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    if (e.repeat) return;
    if (s && !s.outcome) return finish("review");
    if (disabled || phase !== "idle") return;
    hold.current = { at: Date.now() };
    void start("key");
  });
  const onShortcutUp = React.useEffectEvent((e: KeyboardEvent) => {
    const held = hold.current;
    if (!held || !(e.code === "Space" || e.key === "Control" || e.key === "Shift")) return;
    if (e.code === "Space") e.preventDefault();
    hold.current = null;
    if ((session.current || opening.current) && Date.now() - held.at >= HOLD_MS) finish("review");
  });
  React.useEffect(() => {
    if (!shortcut) return;
    const down = (e: KeyboardEvent) => onShortcutDown(e);
    const up = (e: KeyboardEvent) => onShortcutUp(e);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [shortcut]);

  const keys = mac ? t("shortcutKeysMac") : t("shortcutKeys");

  if (phase === "recording" || phase === "starting") {
    const listening = phase === "recording";
    return (
      <div
        data-dictation=""
        className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-muted/70 pl-1 pr-1 text-[13px] animate-message-in"
        role="status"
        aria-live="polite"
        aria-label={listening ? t("recording") : t("starting")}
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
        {/* Red once the microphone really listens; grey for the instant it opens. */}
        <span className="relative ml-1 flex size-2 shrink-0" data-listening={listening || undefined}>
          {listening ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60 motion-reduce:animate-none" /> : null}
          <span className={cn("relative inline-flex size-2 rounded-full transition-colors", listening ? "bg-destructive" : "bg-muted-foreground/40")} />
        </span>
        <canvas ref={canvas} aria-hidden className="h-6 min-w-0 flex-1 text-foreground/70" />
        <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</span>
        <Tooltip content={viaKey ? t("stopKey", { keys }) : t("stop")}>
          {/* Started from the keyboard, the focus stays in the message box (Space would press Stop). */}
          <Button variant="secondary" size="icon-sm" className="size-7 shrink-0 rounded-full" aria-label={t("stop")} autoFocus={!viaKey} onClick={() => finish("review")}>
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

  const working = phase === "transcribing" || phase === "cleaning";
  const label = phase === "cleaning" ? t("cleaning") : phase === "transcribing" ? t("transcribing") : t("start");
  return (
    <Tooltip
      content={
        shortcut && !working ? (
          <span className="block">
            {label}
            <span className="block opacity-70">{t("shortcutHint", { keys })}</span>
          </span>
        ) : (
          label
        )
      }
    >
      <Button
        data-dictation=""
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-keyshortcuts={shortcut ? "Control+Shift+Space" : undefined}
        aria-busy={working}
        disabled={disabled || phase !== "idle"}
        onClick={() => void start("click")}
        className={cn(working && "text-muted-foreground")}
      >
        {working ? <Loader2Icon className="animate-spin" /> : <MicIcon />}
      </Button>
    </Tooltip>
  );
}
