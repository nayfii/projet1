"use client";

import * as React from "react";

/**
 * A light glass pill that glides to the row under the mouse, in a menu (the app's, our console's,
 * Studio's). It only ever moves by transform and fades by opacity, both done by the graphics chip, so
 * it keeps up with the screen (120 Hz included) whatever the page is doing. Nothing re-renders: the
 * pointer moves it directly. Mouse only (touch and pens keep the rows' own pressed state).
 *
 * Put it as the first child of a `position: relative` container; rows are found with `rows`.
 * Small controls inside rows (an options button) are skipped: the pill stays on the row.
 */
export function HoverPill({ rows = "a, button" }: { rows?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const pill = ref.current;
    const nav = pill?.parentElement;
    if (!pill || !nav) return;
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    if (!fine.matches) return;
    nav.setAttribute("data-hover-pill", "");

    let current: HTMLElement | null = null;
    let shown = false;

    const rowAt = (target: EventTarget | null): HTMLElement | null => {
      let el = (target as Element | null)?.closest?.<HTMLElement>(rows) ?? null;
      // A small control inside a row (options, "+"): use the row around it when there is one.
      while (el && el.offsetHeight < 28) {
        const outer: HTMLElement | null = el.parentElement?.closest<HTMLElement>(rows) ?? null;
        if (!outer || !nav.contains(outer)) return null;
        el = outer;
      }
      return el && nav.contains(el) && el.offsetParent !== null ? el : null;
    };

    const moveTo = (row: HTMLElement) => {
      if (row === current) return;
      current = row;
      const a = nav.getBoundingClientRect();
      const b = row.getBoundingClientRect();
      const x = b.left - a.left + nav.scrollLeft;
      const y = b.top - a.top + nav.scrollTop;
      if (!shown) {
        // Arriving from outside the menu: appear on the row, without sliding in from the last one.
        pill.style.transition = "none";
      }
      pill.style.width = `${b.width}px`;
      pill.style.height = `${b.height}px`;
      pill.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (!shown) {
        void pill.offsetWidth; // commit the position before the fade starts
        pill.style.transition = "";
        shown = true;
      }
      pill.style.opacity = "1";
    };
    const hide = () => {
      current = null;
      shown = false;
      pill.style.opacity = "0";
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const row = rowAt(e.target);
      // Between two rows the pill stays where it is (no flicker in the gaps).
      if (row) moveTo(row);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hide();
    };
    nav.addEventListener("pointerover", onOver);
    nav.addEventListener("pointerleave", onLeave);
    // The list scrolled or changed under a still mouse: let the next move place it again.
    nav.addEventListener("scroll", hide, { passive: true });
    return () => {
      nav.removeEventListener("pointerover", onOver);
      nav.removeEventListener("pointerleave", onLeave);
      nav.removeEventListener("scroll", hide);
      nav.removeAttribute("data-hover-pill");
    };
  }, [rows]);

  return <div ref={ref} aria-hidden className="hover-pill" />;
}
