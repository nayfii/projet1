"use client";

import * as React from "react";

const KEY = "cendr-perf";

/**
 * Liquid Glass bends the backdrop and the background moves: costly on a device without a capable
 * graphics chip. Once per visit, a moment after the page settles, the frame rate is sampled; below
 * 35 frames a second the device is marked low-power (<html data-perf="low">), which stills the
 * background and keeps glass frosted without bending (appearance.css). The verdict lasts for the tab.
 */
export function usePerformanceGuard() {
  React.useEffect(() => {
    const root = document.documentElement;
    try {
      const known = sessionStorage.getItem(KEY);
      if (known === "low") root.dataset.perf = "low";
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
        if (now - t0 < 1500) return void requestAnimationFrame(tick);
        const verdict = frames / ((now - t0) / 1000) < 35 ? "low" : "ok";
        if (verdict === "low") root.dataset.perf = "low";
        try {
          sessionStorage.setItem(KEY, verdict);
        } catch {
          // Not remembered: measured again on the next visit.
        }
      };
      requestAnimationFrame(tick);
    };
    timer = window.setTimeout(sample, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", sample);
    };
  }, []);
}
