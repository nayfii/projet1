"use client";

import * as React from "react";
import { useAppearance } from "@/components/appearance/appearance-provider";

/**
 * The desktop menu folds to a rail and back without making the page lay itself out on every frame:
 * the page takes its new place once, then slides there (a transform, done by the graphics chip)
 * while the panel's own width animates on its own layer (appearance.css). Shared by the app, our
 * console and Studio, so the menu moves the same way everywhere.
 */
export function useSidebarFold() {
  const { sidebar, setSidebar } = useAppearance();
  const collapsed = sidebar === "collapsed";
  const asideRef = React.useRef<HTMLElement>(null);
  const columnRef = React.useRef<HTMLDivElement>(null);

  const toggle = () => {
    const column = columnRef.current;
    const aside = asideRef.current;
    const before = column?.getBoundingClientRect().left ?? 0;
    aside?.setAttribute("data-animating", "");
    setSidebar(collapsed ? "expanded" : "collapsed");
    const after = column?.getBoundingClientRect().left ?? 0;
    const settle = () => aside?.removeAttribute("data-animating");
    if (!column || before === after || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.setTimeout(settle, 320);
      return;
    }
    column.style.transition = "none";
    column.style.transform = `translate3d(${before - after}px, 0, 0)`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        column.style.transition = "transform var(--dur-layout) var(--ease-standard)";
        column.style.transform = "";
      }),
    );
    // In any case, at rest after the slide (even if a busy device skipped frames).
    window.setTimeout(() => {
      column.style.transition = "";
      column.style.transform = "";
      settle();
    }, 340);
  };

  return { collapsed, toggle, asideRef, columnRef };
}
