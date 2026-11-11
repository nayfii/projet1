"use client";

import * as React from "react";
import { paletteOf } from "@/lib/ambient/palettes";
import { createAmbientRenderer, type AmbientRenderer } from "@/lib/ambient/renderer";

/** The background is soft: drawn at a fraction of the screen's pixels and smoothed by the browser. */
const RENDER_SCALE = 0.5;
const MAX_WIDTH = 1800;
/** Thirty frames a second is fluid for slow cloth and light, and halves the work of the glass above. */
const FRAME_MS = 1000 / 30;

/**
 * Draws the Atmosphère background and keeps it moving: only while that interface is chosen, the tab
 * is visible and motion is allowed (the person's switch, the device's reduced-motion setting, a
 * low-power device). Otherwise it draws one still frame, or nothing at all with Clair and Sombre.
 */
export function AmbientCanvas() {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const root = document.documentElement;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let renderer: AmbientRenderer | null = null;
    let failed = false;
    let frame = 0;
    let last = 0;
    // The clock only runs while the background moves, so it resumes where it stopped.
    let clock = 8 + Math.random() * 40;

    // Our shader draws the "silk" and "glow" scenes; the Waylume scene draws itself (WaylumeLayer).
    const active = () => root.dataset.theme === "atmosphere" && paletteOf(root.dataset.ambient).scene !== "waylume";
    const moving = () => root.dataset.motion !== "off" && root.dataset.perf !== "low" && !reduced.matches && !document.hidden;

    const fit = () => {
      const scale = Math.min(RENDER_SCALE, MAX_WIDTH / Math.max(1, innerWidth));
      const width = Math.max(1, Math.round(innerWidth * scale));
      const height = Math.max(1, Math.round(innerHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer?.size(width, height);
    };
    const ensure = () => {
      if (!renderer && !failed) {
        renderer = createAmbientRenderer(canvas);
        failed = !renderer;
        fit();
      }
      return renderer;
    };
    const paint = () => {
      const r = ensure();
      if (!r) return;
      r.draw(clock, paletteOf(root.dataset.ambient));
      canvas.dataset.ready = "";
    };
    const loop = (now: number) => {
      frame = 0;
      if (!active() || !moving()) return;
      const dt = now - last;
      if (dt >= FRAME_MS) {
        clock += Math.min(dt, 100) / 1000;
        last = now;
        paint();
      }
      frame = requestAnimationFrame(loop);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!active()) {
        delete canvas.dataset.ready;
        return;
      }
      paint();
      if (moving()) {
        last = performance.now();
        frame = requestAnimationFrame(loop);
      }
    };

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        fit();
        if (active()) paint();
      }, 120);
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      renderer = null;
    };
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-ambient", "data-motion", "data-perf"] });
    document.addEventListener("visibilitychange", update);
    reduced.addEventListener("change", update);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", update);
    update();

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      reduced.removeEventListener("change", update);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", update);
      // The context is not given back: a remount (React's development double run) reuses this canvas.
    };
  }, []);

  return <canvas ref={ref} className="ambient-canvas" />;
}
