"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { EraserIcon, FileTextIcon, ShieldCheckIcon, WandSparklesIcon, type LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { HIDE_MODES, MAX_BLUR_CHARS, type AutoCategory, type HideMode, type Span } from "../categories";
import { spansToMask } from "../mask";
import { foldKey } from "../normalize";

type Detected = Span & { value: string };

/**
 * Asks our server where the text looks sensitive (debounced). Results stay valid for the parts of
 * the text that did not change, so highlights do not flicker while typing.
 */
function useDetection(text: string, enabled: boolean): Span[] {
  const [detected, setDetected] = React.useState<Detected[]>([]);
  React.useEffect(() => {
    if (!enabled || !text.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch("/api/hide/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json().catch(() => null)) as { spans?: Span[] } | null;
      setDetected((body?.spans ?? []).map((s) => ({ ...s, value: text.slice(s.start, s.end) })));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, enabled]);
  if (!enabled) return [];
  return detected.filter((s) => text.slice(s.start, s.end) === s.value);
}

export type HidePayload = { modes: HideMode[]; blur: string[]; unblur: string[] };

/**
 * State of the Hide control for one conversation: modes, and in Manual mode the values the person
 * blurred or left visible. What will be masked is computed with the same rules as the server
 * (`spansToMask`); the server re-detects and decides on its own when the message is sent.
 */
export function useHideComposer({ text, initialModes, autoCategories }: { text: string; initialModes: HideMode[]; autoCategories: AutoCategory[] }) {
  const [modes, setModes] = React.useState<HideMode[]>(initialModes);
  const [blur, setBlur] = React.useState<string[]>([]);
  const [unblur, setUnblur] = React.useState<string[]>([]);
  const [selection, setSelection] = React.useState<string | null>(null);
  const auto = React.useMemo(() => new Set(autoCategories), [autoCategories]);
  const manual = modes.includes("manual");
  const automatic = modes.includes("automatic");
  const detected = useDetection(text, manual || automatic);
  const masked = React.useMemo(() => spansToMask(text, detected, auto, { modes, blur, unblur }), [text, detected, auto, modes, blur, unblur]);

  const toggleMode = (mode: HideMode) => setModes((current) => (current.includes(mode) ? current.filter((m) => m !== mode) : HIDE_MODES.filter((m) => m === mode || current.includes(m))));

  /** Click on a highlighted item (Manual): blur it, or show it again. */
  const toggleAt = (position: number) => {
    const span = masked.find((s) => s.start <= position && position <= s.end) ?? detected.find((s) => s.start <= position && position <= s.end);
    if (!span) return false;
    const value = text.slice(span.start, span.end);
    const key = foldKey(value);
    const isMasked = masked.some((s) => s.start === span.start && s.end === span.end);
    const without = (list: string[]) => list.filter((v) => foldKey(v) !== key);
    if (isMasked) {
      setBlur(without);
      // Still masked by Automatic once removed from the blurred list: leave it visible explicitly.
      if (automatic && span.category !== "redacted" && auto.has(span.category)) setUnblur((u) => [...without(u), value]);
    } else {
      setUnblur(without);
      setBlur((b) => [...without(b), value]);
    }
    return true;
  };

  const blurSelection = () => {
    if (!selection || selection.length > MAX_BLUR_CHARS) return;
    const value = selection;
    setUnblur((u) => u.filter((v) => foldKey(v) !== foldKey(value)));
    setBlur((b) => [...b.filter((v) => foldKey(v) !== foldKey(value)), value]);
    setSelection(null);
  };

  return {
    modes,
    toggleMode,
    manual,
    automatic,
    detected,
    masked,
    toggleAt,
    selection,
    setSelection,
    blurSelection,
    payload: { modes, blur, unblur } satisfies HidePayload,
  };
}

export type HideComposerState = ReturnType<typeof useHideComposer>;

const MODE_ICONS: Record<HideMode, LucideIcon> = { automatic: WandSparklesIcon, documents: FileTextIcon, manual: EraserIcon };

/** The control above the message input: three modes that can be combined, and what will be masked. */
export function HideBar({ state, hasImages, disabled }: { state: HideComposerState; hasImages: boolean; disabled?: boolean }) {
  const t = useTranslations("hide");
  const willMask = state.masked.length;
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs">
      <span className="mr-0.5 inline-flex items-center gap-1 text-muted-foreground">
        <ShieldCheckIcon className={cn("size-3.5", state.modes.length > 0 ? "text-brand" : "text-muted-foreground/70")} />
        {t("protection")}
      </span>
      {HIDE_MODES.map((mode) => {
        const Icon = MODE_ICONS[mode];
        const on = state.modes.includes(mode);
        return (
          <Tooltip key={mode} content={t(`modeHint.${mode}`)}>
            <button
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => state.toggleMode(mode)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full border px-2 font-medium transition-colors disabled:opacity-50",
                on ? "border-brand/30 bg-brand-soft text-brand" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-3" />
              {t(`mode.${mode}`)}
            </button>
          </Tooltip>
        );
      })}
      <span className="ml-auto flex items-center gap-2 text-muted-foreground" aria-live="polite">
        {state.manual && state.selection ? (
          <button
            type="button"
            // Keep the text selected while clicking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={state.blurSelection}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-destructive/30 bg-destructive-soft/60 px-2 font-medium text-destructive"
          >
            <EraserIcon className="size-3" />
            {t("blurSelection")}
          </button>
        ) : null}
        {state.modes.length === 0 ? <span>{t("off")}</span> : null}
        {(state.automatic || state.manual) && willMask > 0 ? <span>{t("willMask", { count: willMask })}</span> : null}
        {state.manual && state.detected.length > 0 && !state.selection ? <span className="hidden sm:inline">{t("manualHelp")}</span> : null}
        {state.modes.includes("documents") && hasImages ? <span className="text-warning">{t("imagesNotMasked")}</span> : null}
      </span>
    </div>
  );
}

/**
 * Manual mode: the text is drawn underneath a transparent textarea, with sensitive items underlined
 * in red and blurred items blurred. Both must share exactly the same font, padding and wrapping.
 */
export function HideOverlay({ text, state, scrollTop, className }: { text: string; state: HideComposerState; scrollTop: number; className: string }) {
  const t = useTranslations("hide");
  const segments: React.ReactNode[] = [];
  const masked = new Set(state.masked.map((s) => `${s.start}:${s.end}`));
  const marks = [...state.masked, ...state.detected.filter((d) => !state.masked.some((m) => d.start < m.end && m.start < d.end))].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const s of marks) {
    if (s.start < cursor) continue;
    segments.push(text.slice(cursor, s.start));
    const isMasked = masked.has(`${s.start}:${s.end}`);
    segments.push(
      <span
        key={`${s.start}:${s.end}`}
        data-hide={isMasked ? "masked" : "detected"}
        title={t(`category.${s.category}`)}
        className={cn("rounded-sm", isMasked ? "bg-foreground/10 blur-[3px]" : "bg-destructive/10 text-destructive underline decoration-destructive/60 decoration-wavy underline-offset-2")}
      >
        {text.slice(s.start, s.end)}
      </span>,
    );
    cursor = s.end;
  }
  segments.push(text.slice(cursor));
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div style={{ transform: `translateY(${-scrollTop}px)` }}>
        {segments}
        {/* A final newline needs a character after it to take up a line, like in the textarea. */}
        {"​"}
      </div>
    </div>
  );
}
