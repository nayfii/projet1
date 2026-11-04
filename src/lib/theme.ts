/**
 * Appearance, chosen per device (cookies read by the root layout, so the first paint is already right):
 * - the interface: dark (the product's default), light, or following the device;
 * - the ambient background behind the glass: Midnight Aurora (default) or Solar Ember;
 * - the background's motion: on, or still (also still whenever the device asks for less motion);
 * - the sidebar: expanded, or a narrow rail of icons.
 */
export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "theme";
export const DEFAULT_THEME: Theme = "dark";

export const AMBIENTS = ["aurora", "ember"] as const;
export type Ambient = (typeof AMBIENTS)[number];
export const AMBIENT_COOKIE = "ambient";
export const DEFAULT_AMBIENT: Ambient = "aurora";

export const MOTIONS = ["on", "off"] as const;
export type Motion = (typeof MOTIONS)[number];
export const MOTION_COOKIE = "motion";
export const DEFAULT_MOTION: Motion = "on";

export const SIDEBAR_COOKIE = "sidebar";
export type SidebarState = "expanded" | "collapsed";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isAmbient(value: unknown): value is Ambient {
  return typeof value === "string" && (AMBIENTS as readonly string[]).includes(value);
}

export function isMotion(value: unknown): value is Motion {
  return typeof value === "string" && (MOTIONS as readonly string[]).includes(value);
}

/** Browser bar colours, matching the base of each background in each theme. */
export const THEME_COLORS: Record<Ambient, { dark: string; light: string }> = {
  aurora: { dark: "#080a12", light: "#eef0f6" },
  ember: { dark: "#150a10", light: "#f8efe9" },
};

/** One year, like the language. */
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The scheme shown for a choice ("system" follows the device; dark is assumed until the page runs). */
export function resolveScheme(theme: Theme, prefersLight = false): "dark" | "light" {
  if (theme === "system") return prefersLight ? "light" : "dark";
  return theme;
}

/**
 * Runs in <head> before the first paint: with "system", shows the device's scheme at once and
 * follows it when it changes (e.g. at sunset), without a flash of the other scheme.
 */
export const SCHEME_SCRIPT = `(function(){try{var d=document.documentElement,m=matchMedia("(prefers-color-scheme: light)");var a=function(){if(d.dataset.theme==="system")d.dataset.scheme=m.matches?"light":"dark"};a();m.addEventListener("change",a)}catch(e){}})();`;
