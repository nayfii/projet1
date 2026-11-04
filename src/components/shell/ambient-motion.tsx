"use client";

import * as React from "react";

/** Each moving layer drifts between two positions (percent of its size) and back, eased. */
const DRIFTS = {
  a: { from: [-1.8, 0.6], to: [2.2, -1.2], seconds: 64, phase: 0 },
  b: { from: [1.6, -0.8], to: [-2.4, 1], seconds: 82, phase: 30 },
} as const;
/** Three small steps a second: smooth to the eye at this pace, and the page is idle in between. */
const STEP_MS = 333;

/**
 * Moves the background very slowly. The layers are only translated (already painted, never
 * repainted), a few times a second rather than every frame, so the glass above is recomputed three
 * times a second instead of sixty. Still when the person turns motion off, when the device asks for
 * less motion, on a low-power device (appearance.css), and while the tab is hidden.
 */
export function AmbientMotion() {
  React.useEffect(() => {
    const root = document.documentElement;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const layers = [...document.querySelectorAll<HTMLElement>(".ambient:not([data-ambient-scope]) .ambient-layer[data-sway]")];
    const place = (now: number) => {
      for (const layer of layers) {
        const drift = DRIFTS[layer.dataset.sway as keyof typeof DRIFTS];
        if (!drift) continue;
        // A ping-pong between the two positions, eased at both ends.
        const cycle = (now / 1000 + drift.phase) / drift.seconds;
        const back = Math.floor(cycle) % 2 === 1;
        const t = back ? 1 - (cycle % 1) : cycle % 1;
        const p = (1 - Math.cos(Math.PI * t)) / 2;
        const x = drift.from[0] + (drift.to[0] - drift.from[0]) * p;
        const y = drift.from[1] + (drift.to[1] - drift.from[1]) * p;
        layer.style.transform = `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0)`;
      }
    };
    const still = () => root.dataset.motion !== "on" || root.dataset.perf === "low" || reduced.matches || document.hidden;
    place(performance.now());
    const timer = window.setInterval(() => {
      if (!still()) place(performance.now());
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
