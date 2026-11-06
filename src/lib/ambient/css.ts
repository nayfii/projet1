import { PALETTES } from "./palettes";

/** Each palette's accent and glass tint, by scheme: the Atmosphère interface takes its colours. */
const ACCENTS: Record<string, { hue: number; accent: string; onAccent: string }> = {
  aurora: { hue: 284, accent: "oklch(0.8 0.1 290)", onAccent: "oklch(0.18 0.04 290)" },
  ember: { hue: 34, accent: "oklch(0.8 0.12 55)", onAccent: "oklch(0.2 0.05 40)" },
  lagoon: { hue: 205, accent: "oklch(0.82 0.1 195)", onAccent: "oklch(0.2 0.04 210)" },
  orchid: { hue: 340, accent: "oklch(0.8 0.11 345)", onAccent: "oklch(0.2 0.05 340)" },
  waylume: { hue: 300, accent: "oklch(0.78 0.13 305)", onAccent: "oklch(0.18 0.05 300)" },
  waylumeNight: { hue: 300, accent: "oklch(0.78 0.13 305)", onAccent: "oklch(0.18 0.05 300)" },
  pearl: { hue: 285, accent: "oklch(0.5 0.17 288)", onAccent: "oklch(0.99 0.003 288)" },
  peach: { hue: 40, accent: "oklch(0.56 0.16 40)", onAccent: "oklch(0.99 0.004 40)" },
};

/**
 * CSS for the Atmosphère palettes, generated from the same definitions as the background shader so
 * the colours never drift apart: the background colours (the stand-in gradient before the canvas
 * draws), the glass tint and the accent.
 */
export function paletteStyles(): string {
  return PALETTES.map((p) => {
    const a = ACCENTS[p.id];
    const c = p.colors;
    return `:root[data-theme="atmosphere"][data-ambient="${p.id}"]{--background:${c.base};--amb-base:${c.base};--amb-deep:${c.deep};--amb-c2:${c.c2};--amb-c3:${c.c3};--tint-h:${a.hue};--brand:${a.accent};--ring:${a.accent};--brand-foreground:${a.onAccent};--brand-soft:color-mix(in oklch,${a.accent} ${p.scheme === "light" ? 10 : 15}%,transparent);--lg-on:${a.accent};--lg-fill:${a.accent}}`;
  }).join("\n");
}
