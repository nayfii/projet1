/**
 * The "Atmosphère" interface: glass over a living background. Each palette is one background
 * (the shapes, "silk" folds or a "glow" band drawn by our shader, or "waylume", a scene exported from
 * the Waylume studio) with its colours and the scheme the glass takes on it.
 * Clair and Sombre have no background: a plain white or black interface.
 */
export type AmbientScene = "silk" | "glow" | "waylume";

export type AmbientPalette = {
  id: string;
  scene: AmbientScene;
  scheme: "dark" | "light";
  /** Base, deep, four tints and a rim (highlight) colour, as #rrggbb. */
  colors: { base: string; deep: string; c1: string; c2: string; c3: string; c4: string; rim: string };
};

export const PALETTES = [
  {
    id: "aurora",
    scene: "silk",
    scheme: "dark",
    colors: { base: "#06070e", deep: "#10182c", c1: "#27245a", c2: "#6554a8", c3: "#3569a8", c4: "#7a3270", rim: "#cdbdf5" },
  },
  {
    id: "ember",
    scene: "glow",
    scheme: "dark",
    colors: { base: "#160a0e", deep: "#2a1220", c1: "#ecbc5c", c2: "#e39a5a", c3: "#d4603f", c4: "#9c2f24", rim: "#4a2378" },
  },
  {
    id: "lagoon",
    scene: "silk",
    scheme: "dark",
    colors: { base: "#03090f", deep: "#0a1d2a", c1: "#0d4f63", c2: "#1f8a9a", c3: "#2756a8", c4: "#1a6f6a", rim: "#bff3f2" },
  },
  {
    id: "orchid",
    scene: "silk",
    scheme: "dark",
    colors: { base: "#0d050c", deep: "#1f0b1c", c1: "#5a1f5a", c2: "#b04a8e", c3: "#6a3ab0", c4: "#d0698f", rim: "#f6cde6" },
  },
  {
    // Exported from the Waylume studio (components/ambient/WaylumeBackground.tsx, kept verbatim);
    // these colours are its own, for the accent, the preview and the stand-in gradient.
    id: "waylume",
    scene: "waylume",
    scheme: "dark",
    colors: { base: "#07040f", deep: "#120a24", c1: "#9b6cff", c2: "#ff4797", c3: "#2d79f0", c4: "#9b6cff", rim: "#e8d9ff" },
  },
  {
    id: "pearl",
    scene: "silk",
    scheme: "light",
    colors: { base: "#eef0f7", deep: "#d9dcec", c1: "#d6d1f3", c2: "#c3b6ee", c3: "#bcd0f2", c4: "#ecd2ea", rim: "#ffffff" },
  },
  {
    id: "peach",
    scene: "glow",
    scheme: "light",
    colors: { base: "#fbf2ec", deep: "#f3e2e6", c1: "#f9dca4", c2: "#f7c49a", c3: "#f2a48e", c4: "#e99c9c", rim: "#d9c8f2" },
  },
] as const satisfies readonly AmbientPalette[];

export type AmbientId = (typeof PALETTES)[number]["id"];
export const AMBIENT_IDS = PALETTES.map((p) => p.id) as AmbientId[];
export const DEFAULT_AMBIENT: AmbientId = "aurora";

export function isAmbientId(value: unknown): value is AmbientId {
  return typeof value === "string" && (AMBIENT_IDS as string[]).includes(value);
}

export function paletteOf(id: string | undefined): AmbientPalette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}
