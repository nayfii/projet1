"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangleIcon, ShieldCheckIcon, ShieldIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { MAX_BLUR_CHARS, type AutoCategory, type HideMode, type Span } from "../categories";
import { spansToMask } from "../mask";
import { foldKey } from "../normalize";

/**
 * Hide, as validated with the founder: what looks sensitive is RED (the AI would see it); a click
 * strikes it through in GREEN (protected: the AI gets a placeholder). With "Masquage auto" on,
 * everything detected starts green, and a click leaves an item visible. Attached files follow the
 * same rule, in a preview. Detection runs on our server; the server decides again at send time.
 */

/** Red = visible to the AI, green struck = protected. Shared by the input, file previews and sent messages. */
export const HIDE_VISIBLE_CLASS = "rounded-sm bg-destructive-soft text-destructive";
export const HIDE_PROTECTED_CLASS = "rounded-sm bg-success-soft text-success line-through decoration-2 decoration-success";

type Detected = Span & { value: string };

async function fetchSpans(text: string, signal?: AbortSignal): Promise<Span[] | null> {
  const response = await fetch("/api/hide/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { spans?: Span[] } | null;
  return body?.spans ?? [];
}

/** Detection on our server while typing (debounced), plus `detectNow` for the moment of sending. */
function useDetection(text: string) {
  const [result, setResult] = React.useState<{ text: string; spans: Detected[] }>({ text: "", spans: [] });
  const store = React.useCallback((forText: string, spans: Span[]) => {
    setResult({ text: forText, spans: spans.map((s) => ({ ...s, value: forText.slice(s.start, s.end) })) });
  }, []);
  React.useEffect(() => {
    if (!text.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const spans = await fetchSpans(text, controller.signal);
      if (spans) store(text, spans);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, store]);
  return {
    // Results stay valid for the parts of the text that did not change: no flicker while typing.
    spans: result.spans.filter((s) => text.slice(s.start, s.end) === s.value) as Span[],
    fresh: !text.trim() || result.text === text,
    detectNow: async (): Promise<Span[]> => {
      const spans = (await fetchSpans(text)) ?? [];
      store(text, spans);
      return spans;
    },
  };
}

export type HideFile = { key: string; filename: string; text: string; spans: Span[] };
export type HidePayload = { modes: HideMode[]; blur: string[]; unblur: string[] };
export type HideSegment = { text: string; state: "plain" | "visible" | "protected"; span?: Span };

export function useHideComposer({
  text,
  files,
  initialAuto,
  autoCategories,
}: {
  text: string;
  files: HideFile[];
  initialAuto: boolean;
  autoCategories: AutoCategory[];
}) {
  const [auto, setAuto] = React.useState(initialAuto);
  const [blur, setBlur] = React.useState<string[]>([]);
  const [unblur, setUnblur] = React.useState<string[]>([]);
  const [selection, setSelection] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const categories = React.useMemo(() => new Set(autoCategories), [autoCategories]);
  // Clicks always apply ("manual"); "automatic" protects the company's categories by default.
  const modes: HideMode[] = auto ? ["automatic", "manual"] : ["manual"];
  // Only the categories the company considers sensitive are highlighted (amounts are off by default);
  // anything else can still be protected by selecting it.
  const sensitive = (found: Span[]) => found.filter((s) => s.category !== "redacted" && categories.has(s.category));
  const detection = useDetection(text);
  const detected = sensitive(detection.spans);

  const analyse = (body: string, found: Span[]) => {
    const masked = spansToMask(body, found, categories, { modes, blur, unblur });
    const isMasked = (s: Span) => masked.some((m) => m.start === s.start && m.end === s.end);
    const visible = found.filter((s) => !masked.some((m) => s.start < m.end && m.start < s.end));
    return { masked, visible, isMasked };
  };
  const message = analyse(text, detected);
  const fileStates = files.map((f) => ({ ...f, spans: sensitive(f.spans), ...analyse(f.text, sensitive(f.spans)) }));
  const protectedCount = message.masked.length + fileStates.reduce((n, f) => n + f.masked.length, 0);
  const visibleCount = message.visible.length + fileStates.reduce((n, f) => n + f.visible.length, 0);

  const toggleValue = (value: string, category: Span["category"], masked: boolean) => {
    const key = foldKey(value);
    const without = (list: string[]) => list.filter((v) => foldKey(v) !== key);
    setConfirming(false);
    if (masked) {
      setBlur(without);
      // Still protected by "Masquage auto" once removed from the protected list: leave it visible explicitly.
      if (auto && category !== "redacted" && categories.has(category)) setUnblur((u) => [...without(u), value]);
    } else {
      setUnblur(without);
      setBlur((b) => [...without(b), value]);
    }
  };

  /** Segments for drawing a text: plain, red (visible to the AI) or green struck (protected). */
  const segments = (body: string, found: Span[]): HideSegment[] => {
    const { masked, isMasked } = analyse(body, found);
    const marks = [...masked, ...found.filter((d) => !masked.some((m) => d.start < m.end && m.start < d.end))].sort((a, b) => a.start - b.start);
    const out: HideSegment[] = [];
    let cursor = 0;
    for (const s of marks) {
      if (s.start < cursor) continue;
      if (s.start > cursor) out.push({ text: body.slice(cursor, s.start), state: "plain" });
      out.push({ text: body.slice(s.start, s.end), state: isMasked(s) ? "protected" : "visible", span: s });
      cursor = s.end;
    }
    if (cursor < body.length) out.push({ text: body.slice(cursor), state: "plain" });
    return out;
  };

  return {
    auto,
    setAuto: (on: boolean) => {
      setAuto(on);
      setConfirming(false);
    },
    detected,
    protectedCount,
    visibleCount,
    hasDetections: protectedCount + visibleCount > 0,
    files: fileStates,
    segments,
    toggleSegment: (segment: HideSegment) => segment.span && toggleValue(segment.text, segment.span.category, segment.state === "protected"),
    /** Click in the input: toggles the item under the caret. */
    toggleAt: (position: number) => {
      const hit = segments(text, detected).find((s) => s.span && s.span.start <= position && position <= s.span.end);
      if (hit) toggleValue(hit.text, hit.span!.category, hit.state === "protected");
    },
    protectAll: () => {
      const values = [...message.visible.map((s) => text.slice(s.start, s.end)), ...fileStates.flatMap((f) => f.visible.map((s) => f.text.slice(s.start, s.end)))];
      const keys = new Set(values.map(foldKey));
      setUnblur((u) => u.filter((v) => !keys.has(foldKey(v))));
      setBlur((b) => [...b.filter((v) => !keys.has(foldKey(v))), ...values]);
      setConfirming(false);
    },
    selection,
    setSelection,
    protectSelection: () => {
      if (!selection || selection.length > MAX_BLUR_CHARS) return;
      const key = foldKey(selection);
      setUnblur((u) => u.filter((v) => foldKey(v) !== key));
      setBlur((b) => [...b.filter((v) => foldKey(v) !== key), selection]);
      setSelection(null);
    },
    /**
     * Without "Masquage auto", red items are confirmed before sending. Detection of the exact text
     * being sent is awaited first, so sending quickly cannot skip the check.
     */
    needsConfirmation: async (): Promise<boolean> => {
      if (auto) return false;
      const found = detection.fresh ? detected : sensitive(await detection.detectNow());
      return analyse(text, found).visible.length + fileStates.reduce((n, f) => n + f.visible.length, 0) > 0;
    },
    confirming,
    setConfirming,
    payload: (): HidePayload => ({ modes, blur, unblur }),
    /** The payload once every visible item is protected ("Protéger et envoyer"). */
    payloadProtectingAll: (): HidePayload => {
      const values = [...message.visible.map((s) => text.slice(s.start, s.end)), ...fileStates.flatMap((f) => f.visible.map((s) => f.text.slice(s.start, s.end)))];
      const keys = new Set(values.map(foldKey));
      return { modes, blur: [...blur.filter((v) => !keys.has(foldKey(v))), ...values], unblur: unblur.filter((v) => !keys.has(foldKey(v))) };
    },
  };
}

export type HideComposerState = ReturnType<typeof useHideComposer>;

/** Above the input: what is protected or still visible, "Tout protéger", the confirmation before sending. */
export function HideBar({ state, onProtectAndSend, onSendAnyway }: { state: HideComposerState; onProtectAndSend: () => void; onSendAnyway: () => void }) {
  const t = useTranslations("hide");
  if (state.confirming) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
        <AlertTriangleIcon className="size-4 shrink-0" />
        <span className="flex-1">{t("confirm", { count: state.visibleCount })}</span>
        <Button size="sm" onClick={onProtectAndSend}>
          {t("protectAndSend")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onSendAnyway} className="text-destructive hover:text-destructive">
          {t("sendAnyway")}
        </Button>
      </div>
    );
  }
  if (!state.hasDetections && !state.selection) return null;
  const alert = state.visibleCount > 0;
  return (
    <div
      aria-live="polite"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-1.5 text-[13px]", alert ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success")}
    >
      {state.selection ? (
        <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={state.protectSelection} className="h-7">
          <ShieldCheckIcon />
          {t("protectSelection", { text: state.selection.length > 24 ? `${state.selection.slice(0, 24)}…` : state.selection })}
        </Button>
      ) : null}
      {state.hasDetections ? (
        <>
          <span className="flex flex-1 items-center gap-1.5">
            {alert ? <span className="size-2 shrink-0 rounded-full bg-destructive" /> : <ShieldCheckIcon className="size-4 shrink-0" />}
            {alert
              ? state.protectedCount > 0
                ? t("barMixed", { protected: state.protectedCount, visible: state.visibleCount })
                : t("barVisible", { count: state.visibleCount })
              : t("barProtected", { count: state.protectedCount })}
          </span>
          {alert ? (
            <Button size="sm" onClick={state.protectAll} className="h-7">
              {t("protectAll")}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** In the input's toolbar: the one switch. */
export function AutoSwitch({ state, disabled }: { state: HideComposerState; disabled?: boolean }) {
  const t = useTranslations("hide");
  return (
    <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-accent">
      {state.auto ? <ShieldCheckIcon className="size-4 text-success" /> : <ShieldIcon className="size-4" />}
      <span className="hidden sm:inline">{t("auto")}</span>
      <Switch checked={state.auto} onCheckedChange={state.setAuto} disabled={disabled} aria-label={t("auto")} />
    </label>
  );
}

/**
 * The text drawn under a transparent textarea, with items in red or struck green. Both must share
 * exactly the same font, padding and wrapping (`className`).
 */
export function HideOverlay({ text, state, scrollTop, className }: { text: string; state: HideComposerState; scrollTop: number; className: string }) {
  const t = useTranslations("hide");
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div style={{ transform: `translateY(${-scrollTop}px)` }}>
        {state.segments(text, state.detected).map((s, i) =>
          s.state === "plain" ? (
            <React.Fragment key={i}>{s.text}</React.Fragment>
          ) : (
            <span key={i} data-hide={s.state} title={t(`category.${s.span!.category}`)} className={s.state === "protected" ? HIDE_PROTECTED_CLASS : HIDE_VISIBLE_CLASS}>
              {s.text}
            </span>
          ),
        )}
        {/* A final newline needs a character after it to take up a line, like in the textarea. */}
        {"​"}
      </div>
    </div>
  );
}

/** What an attached file will send: same red / green rule, a click on an item switches it. */
export function FilePreview({ file, state, onClose }: { file: HideComposerState["files"][number] | null; state: HideComposerState; onClose: () => void }) {
  const t = useTranslations("hide");
  const tCommon = useTranslations("common");
  return (
    <Sheet open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" title={file?.filename ?? t("filePreview")}>
        {file ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start gap-3 border-b px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.filename}</p>
                <p className="text-xs text-muted-foreground">{state.auto ? t("previewAuto") : t("previewManual")}</p>
              </div>
              <SheetClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label={tCommon("close")}>
                  <XIcon />
                </Button>
              </SheetClose>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-7 break-words whitespace-pre-wrap">
                {state.segments(file.text, file.spans).map((s, i) =>
                  s.state === "plain" ? (
                    <React.Fragment key={i}>{s.text}</React.Fragment>
                  ) : (
                    <button
                      key={i}
                      type="button"
                      data-hide={s.state}
                      onClick={() => state.toggleSegment(s)}
                      aria-label={s.state === "protected" ? t("showItem", { text: s.text }) : t("protectItem", { text: s.text })}
                      className={cn("px-0.5", s.state === "protected" ? HIDE_PROTECTED_CLASS : HIDE_VISIBLE_CLASS)}
                    >
                      {s.text}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              {file.visible.length > 0 ? (
                <Button variant="outline" onClick={state.protectAll}>
                  {t("protectAll")}
                </Button>
              ) : null}
              <Button onClick={onClose}>{t("done")}</Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Text of a sent message with its protected values struck through in green. */
export function ProtectedText({ text, spans }: { text: string; spans: Span[] }) {
  const t = useTranslations("hide");
  if (spans.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < cursor || s.end > text.length) continue;
    out.push(text.slice(cursor, s.start));
    out.push(
      <span key={s.start} title={t("protectedTitle")} className={HIDE_PROTECTED_CLASS}>
        {text.slice(s.start, s.end)}
      </span>,
    );
    cursor = s.end;
  }
  out.push(text.slice(cursor));
  return <>{out}</>;
}
