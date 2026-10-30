/** Appearance chosen per device (cookie). Near-black is the product's default. */
export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "theme";
export const DEFAULT_THEME: Theme = "dark";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Browser bar colours, matching --background in each theme. */
export const THEME_COLORS = { dark: "#08080b", light: "#fcfcfb" } as const;
