"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { capFrames } from "./frame-cap";

/** The Waylume scenes' code (about 75 kB each) loads only for people who choose one. */
const WaylumeBackground = dynamic(() => import("./WaylumeBackground"), { ssr: false });
const WaylumeNightBackground = dynamic(() => import("./WaylumeNightBackground"), { ssr: false });

const SCENES = { waylume: WaylumeBackground, waylumeNight: WaylumeNightBackground } as const;
type Variant = keyof typeof SCENES;

/** "off", or "<variant>:<on|paused|light>". */
type Snapshot = "off" | `${Variant}:${"on" | "paused" | "light"}`;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-ambient", "data-motion", "data-perf", "data-glass"] });
  return () => observer.disconnect();
}

function snapshot(): Snapshot {
  const root = document.documentElement;
  const variant = root.dataset.ambient as Variant | undefined;
  if (root.dataset.theme !== "atmosphere" || !variant || !(variant in SCENES)) return "off";
  if (root.dataset.motion === "off" || root.dataset.perf === "low") return `${variant}:paused`;
  // A graphics chip that struggles (frame-rate check): the scene is drawn at half resolution.
  return root.dataset.glass === "flat" ? `${variant}:light` : `${variant}:on`;
}

/** How much of the scene a device can afford this session: 0 full, 1 lighter. It is never frozen for speed. */
type Level = 0 | 1;
/** A new key: sessions where an earlier, stricter check had frozen the scene start fresh. */
const LEVEL_KEY = "cendr-waylume-level-v2";
/** Frames are capped at 60 a second; below 30 for three measures in a row (6 s), the drawing gets lighter. */
const SLOW_FPS = 30;
const SLOW_MEASURES = 3;

function savedLevel(): Level {
  try {
    return sessionStorage.getItem(LEVEL_KEY) === "1" ? 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * While the scene moves at full quality, the page's frame rate is measured every 2 seconds. When it
 * stays clearly too low, the scene is drawn lighter (fewer pixels) for the rest of the session. The
 * motion itself always continues: only "Fond animé" off, reduced motion or a device without a
 * graphics chip show a still frame.
 */
function useSmoothness(active: boolean, onSlow: () => void) {
  React.useEffect(() => {
    if (!active) return;
    let raf = 0;
    let start = 0;
    let last = 0;
    let frames = 0;
    let slow = 0;
    const tick = (now: number) => {
      // A fresh measure after the tab was hidden or the computer slept.
      if (start === 0 || now - last > 1000) {
        start = now;
        frames = 0;
      }
      last = now;
      frames += 1;
      if (now - start >= 2000) {
        const fps = (frames - 1) / ((now - start) / 1000);
        slow = fps < SLOW_FPS ? slow + 1 : 0;
        start = now;
        frames = 1;
        if (slow >= SLOW_MEASURES) return onSlow();
      }
      raf = requestAnimationFrame(tick);
    };
    const restart = () => {
      start = 0;
      slow = 0;
    };
    // Measured once the page has settled (first paint, fonts, the scene's own start).
    const warm = window.setTimeout(() => (raf = requestAnimationFrame(tick)), 5000);
    document.addEventListener("visibilitychange", restart);
    return () => {
      window.clearTimeout(warm);
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [active, onSlow]);
}

/**
 * The Waylume backgrounds of the Atmosphère interface, when one is chosen. Same rules as our own
 * backgrounds: still when motion is off, for reduced motion, or when the device has no graphics
 * chip; otherwise it moves, drawn at reduced resolution and at most 60 frames a second, lighter if
 * the page is clearly struggling. Waylume itself pauses offscreen and in hidden tabs. Nothing runs
 * otherwise.
 */
export function WaylumeLayer() {
  const state = React.useSyncExternalStore(subscribe, snapshot, () => "off" as Snapshot);
  const [level, setLevel] = React.useState<Level>(() => (typeof window === "undefined" ? 0 : savedLevel()));
  const lighter = React.useCallback(() => {
    setLevel(1);
    try {
      sessionStorage.setItem(LEVEL_KEY, "1");
    } catch {
      // Not remembered: measured again on the next visit.
    }
  }, []);
  const animated = state !== "off" && !state.endsWith(":paused");
  // The scene draws on every frame the screen offers (120 a second on many laptops): capped at 60.
  React.useEffect(() => (animated ? capFrames() : undefined), [animated]);
  useSmoothness(animated && level === 0 && !state.endsWith(":light"), lighter);
  if (state === "off") return null;
  const [variant, mode] = state.split(":") as [Variant, "on" | "paused" | "light"];
  const Scene = SCENES[variant];
  if (mode === "paused") return <Scene paused />;
  // Drawn at half resolution and enlarged (a quarter of the pixels): the scene is soft light, the
  // difference does not show, the graphics chip does four times less work on every frame. A chip
  // that struggles gets a third.
  const scale = mode === "light" || level === 1 ? 3 : 2;
  return (
    <div aria-hidden className="absolute left-0 top-0 origin-top-left" style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})` }}>
      <Scene />
    </div>
  );
}

/** A still frame of a Waylume scene, for the palette tile in Settings → Appearance. */
export function WaylumePreview({ variant = "waylume" }: { variant?: string }) {
  const Scene = SCENES[(variant in SCENES ? variant : "waylume") as Variant];
  return <Scene paused />;
}
