"use client";

import * as React from "react";

/** Set before the first paint by SCHEME_SCRIPT when the device draws without a graphics chip. */
export const PERF_KEY = "cendr-gpu";
/** Set by the frame-rate check below when the glass's bending is too heavy for this device. */
export const GLASS_KEY = "cendr-glass";

/**
 * Two levels, so a device keeps as much of the experience as it can carry:
 * - no graphics chip (software rendering, caught before the first paint by SCHEME_SCRIPT in
 *   lib/theme.ts): <html data-perf="low">, the background is still and glass does not bend;
 * - a graphics chip that struggles: once per visit, a moment after the page settles, the frame rate
 *   is sampled; below 30 frames a second, <html data-glass="flat"> turns off only the glass's bending
 *   (the costliest part). The background keeps moving: our shader is light, and the Waylume scene
 *   lowers its own resolution when frames run late.
 * Settings → Appearance says when either applies and offers to turn the effects back on.
 */
export function usePerformanceGuard() {
  React.useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.perf === "low") return;
    try {
      const known = sessionStorage.getItem(GLASS_KEY);
      if (known === "flat") root.dataset.glass = "flat";
      if (known) return;
    } catch {
      // Storage refused (private mode): measure anyway, without remembering.
    }
    let cancelled = false;
    let timer = 0;
    const sample = () => {
      if (document.hidden) {
        document.addEventListener("visibilitychange", sample, { once: true });
        return;
      }
      let frames = 0;
      const t0 = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        frames++;
        if (now - t0 < 2000) return void requestAnimationFrame(tick);
        const verdict = frames / ((now - t0) / 1000) < 30 ? "flat" : "ok";
        if (verdict === "flat") root.dataset.glass = "flat";
        try {
          sessionStorage.setItem(GLASS_KEY, verdict);
        } catch {
          // Not remembered: measured again on the next visit.
        }
      };
      requestAnimationFrame(tick);
    };
    timer = window.setTimeout(sample, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", sample);
    };
  }, []);
}
