"use client";

import * as React from "react";
import { Glass } from "glisse";
import { cn } from "@/lib/utils";

/**
 * Liquid Glass (glisse): a pane that bends what is behind it at its rim, with a painted lit edge and a
 * touch of colour dispersion. Chromium bends the live backdrop; other browsers keep the frost and
 * the lit rim. The material (fill, frost) comes from the `lq-*` classes in appearance.css.
 *
 * The pane is frosted glass from the first paint (plain CSS). glisse's lens is a separate layer
 * behind the content, added once the page is quiet: glisse computes the lens for every pixel of the
 * pane, which takes a moment, so it never competes with the first clicks after a page opens, and the
 * content itself is never re-created when the lens arrives. A low-power device never computes it.
 *
 * glisse sizes the bend as a share of the pane's shorter side; `reach` keeps it in pixels instead,
 * so a small chip and a tall panel bend their edges by the same amount.
 */
export type LiquidMaterial = "panel" | "card" | "solid" | "lens";

const FROST: Record<LiquidMaterial, string> = {
  panel: "glass-elevated",
  card: "glass-standard",
  solid: "glass-solid",
  lens: "glass-lens-fallback",
};

type LiquidGlassProps = React.ComponentProps<"div"> & {
  material?: LiquidMaterial;
  /** How far, in pixels, the rim pulls the backdrop. */
  reach?: number;
};

function LiquidGlass({ material = "card", reach = 26, className, children, ...props }: LiquidGlassProps) {
  const liquid = useQuietPage();
  return (
    <div data-liquid={liquid ? "" : undefined} className={cn("lq-host isolate", FROST[material], className)} {...props}>
      {liquid ? <Lens material={material} reach={reach} /> : null}
      {children}
    </div>
  );
}

/** The bending layer: same size and corners as its pane, behind the pane's content. */
function Lens({ material, reach }: { material: LiquidMaterial; reach: number }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tune = () => {
      const side = Math.min(el.offsetWidth, el.offsetHeight);
      if (side > 0) el.style.setProperty("--lg-glass-bend", String(Math.min(0.6, reach / side)));
    };
    tune();
    const observer = new ResizeObserver(tune);
    observer.observe(el);
    return () => observer.disconnect();
  }, [reach]);
  return <Glass ref={ref} aria-hidden className={`lq lq-${material} lq-layer`} />;
}

/**
 * True once the page is quiet: a moment after it opens, when the browser is idle and the person has
 * not moved, scrolled, pressed or typed for a little while. Never on a low-power device. Shared by
 * every pane.
 */
let quiet = false;
const waiting = new Set<() => void>();
let lastInput = 0;
let started = false;

function startWatching() {
  if (started || typeof window === "undefined") return;
  started = true;
  // Any sign of activity postpones the lens: a moving pointer is usually about to click.
  const mark = () => (lastInput = performance.now());
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"]) {
    window.addEventListener(type, mark, { capture: true, passive: true });
  }
  const idle = (fn: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(fn, { timeout: 3000 }) : window.setTimeout(fn, 200));
  const check = () => {
    if (document.documentElement.dataset.perf === "low") return window.setTimeout(check, 4000);
    if (performance.now() - lastInput < 900) return window.setTimeout(check, 500);
    quiet = true;
    for (const fn of waiting) fn();
    waiting.clear();
  };
  window.setTimeout(() => idle(check), 1500);
}

function useQuietPage(): boolean {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (quiet) {
      const id = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(id);
    }
    startWatching();
    const done = () => setReady(true);
    waiting.add(done);
    return () => void waiting.delete(done);
  }, []);
  // A device marked low-power later (frame-rate check) drops the lens.
  React.useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (root.dataset.perf === "low") setReady(false);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-perf"] });
    return () => observer.disconnect();
  }, [ready]);
  return ready;
}

export { LiquidGlass };
