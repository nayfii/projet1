"use client";

import * as React from "react";
import { Glass } from "glisse";
import { cn } from "@/lib/utils";

/**
 * Liquid Glass (glisse): a pane that bends what is behind it at its rim, with a painted lit edge
 * and a touch of colour dispersion. Chromium bends the live backdrop; other browsers keep the frost
 * and the lit rim. The material (fill, frost) comes from the `lq-*` classes in appearance.css.
 *
 * glisse sizes the bend as a share of the pane's shorter side; `reach` keeps it in pixels instead,
 * so a small chip and a tall panel bend their edges by the same amount.
 */
export type LiquidMaterial = "panel" | "card" | "solid" | "lens";

type LiquidGlassProps = React.ComponentProps<"div"> & {
  material?: LiquidMaterial;
  /** How far, in pixels, the rim pulls the backdrop. */
  reach?: number;
};

function LiquidGlass({ material = "card", reach = 26, className, style, ref, ...props }: LiquidGlassProps) {
  const inner = React.useRef<HTMLDivElement | null>(null);
  React.useImperativeHandle(ref, () => inner.current as HTMLDivElement);

  React.useLayoutEffect(() => {
    const el = inner.current;
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

  return <Glass ref={inner} className={cn(`lq lq-${material}`, className)} style={style} {...props} />;
}

export { LiquidGlass };
