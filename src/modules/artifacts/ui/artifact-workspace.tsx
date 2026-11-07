"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

const KEY = "cendr-workspace-width";
const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 360;
/** At most this share of the window, so the conversation keeps room. */
const MAX_SHARE = 0.68;

const clamp = (w: number) => Math.round(Math.max(MIN_WIDTH, Math.min(w, typeof window === "undefined" ? 1200 : window.innerWidth * MAX_SHARE)));

/** The workspace's width, kept on this device. */
export function useStoredWidth(): [number, (w: number) => void] {
  const [width, setWidth] = React.useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    // Without a width chosen, at most 42 % of the window: the conversation keeps room.
    const fallback = clamp(Math.min(DEFAULT_WIDTH, window.innerWidth * 0.42));
    try {
      const saved = Number(localStorage.getItem(KEY));
      return saved ? clamp(saved) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = React.useCallback((w: number) => {
    const next = clamp(w);
    setWidth(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // Not kept: the default width comes back next time.
    }
  }, []);
  return [width, set];
}

/**
 * The column on the right of the conversation that holds the open artifact. On a large screen it sits
 * beside the chat and its left edge can be dragged (or moved with ← →; a double-click restores the
 * default width); on a small screen it covers the chat, closed with its own button.
 */
export function ArtifactWorkspace({ width, onWidth, onClose, panel }: { width: number; onWidth: (w: number) => void; onClose: () => void; panel: React.ReactNode }) {
  const t = useTranslations("artifacts");
  const drag = React.useRef<{ x: number; width: number } | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the workspace on a small screen, where it covers the conversation.
      if (e.key === "Escape" && window.innerWidth < 1024 && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      style={{ "--workspace-width": `${width}px` } as React.CSSProperties}
      className="fixed inset-0 z-40 flex flex-col bg-background lg:relative lg:inset-auto lg:z-auto lg:w-[var(--workspace-width)] lg:shrink-0 lg:border-l"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("resize")}
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, width };
        }}
        onPointerMove={(e) => {
          if (drag.current) onWidth(drag.current.width + (drag.current.x - e.clientX));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => onWidth(DEFAULT_WIDTH)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onWidth(width + 32);
          if (e.key === "ArrowRight") onWidth(width - 32);
        }}
        className="absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-foreground/25 focus-visible:after:bg-ring lg:block"
      />
      {panel}
    </aside>
  );
}
