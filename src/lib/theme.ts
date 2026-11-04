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
 * Runs in <head> before the first paint:
 * - with "system", shows the device's scheme at once and follows it when it changes (e.g. at sunset);
 * - a device that draws without a graphics chip (software rendering, common in virtual machines and
 *   remote desktops) is marked low-power at once, so it never pays for bending glass and motion
 *   (see components/appearance/performance-guard.ts, which also checks the frame rate). The verdict is
 *   kept for the tab.
 */
export const SCHEME_SCRIPT = `(function(){var d=document.documentElement;try{var m=matchMedia("(prefers-color-scheme: light)");var a=function(){if(d.dataset.theme==="system")d.dataset.scheme=m.matches?"light":"dark"};a();m.addEventListener("change",a)}catch(e){}try{var k="cendr-perf",v=sessionStorage.getItem(k);if(v==="low"){d.dataset.perf="low"}else if(!v){var c=document.createElement("canvas"),g=c.getContext("webgl"),r="";if(g){var x=g.getExtension("WEBGL_debug_renderer_info");r=String(g.getParameter(x?x.UNMASKED_RENDERER_WEBGL:g.RENDERER));var l=g.getExtension("WEBGL_lose_context");if(l)l.loseContext()}if(!g||/swiftshader|llvmpipe|softpipe|software|basic render/i.test(r)){d.dataset.perf="low";sessionStorage.setItem(k,"low")}}}catch(e){}})();`;
