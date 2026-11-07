import { AMBIENT_IDS, DEFAULT_AMBIENT as DEFAULT_PALETTE, isAmbientId, paletteOf, type AmbientId } from "./ambient/palettes";

/**
 * Appearance, chosen per device (cookies read by the root layout, so the first paint is already right):
 * - the interface: Sombre (plain black, the product's default), Clair (plain white), Système (follows
 *   the device), or Atmosphère (glass over a living background, in the colours chosen below);
 * - the Atmosphère colours (palettes in lib/ambient/palettes.ts);
 * - the background's motion: on, or still (also still whenever the device asks for less motion);
 * - the sidebar: expanded, or a narrow rail of icons.
 */
export const THEMES = ["light", "dark", "system", "atmosphere"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "theme";
export const DEFAULT_THEME: Theme = "dark";

export const AMBIENTS = AMBIENT_IDS;
export type Ambient = AmbientId;
export const AMBIENT_COOKIE = "ambient";
export const DEFAULT_AMBIENT: Ambient = DEFAULT_PALETTE;

export const MOTIONS = ["on", "off"] as const;
export type Motion = (typeof MOTIONS)[number];
export const MOTION_COOKIE = "motion";
export const DEFAULT_MOTION: Motion = "on";

export const SIDEBAR_COOKIE = "sidebar";

/** The glass: clear (neutral, the default) or tinted violet (the earlier look). */
export const GLASS_TONES = ["clear", "tinted"] as const;
export type GlassTone = (typeof GLASS_TONES)[number];
export const GLASS_TONE_COOKIE = "glass_tone";
export const DEFAULT_GLASS_TONE: GlassTone = "clear";
export function isGlassTone(value: unknown): value is GlassTone {
  return typeof value === "string" && (GLASS_TONES as readonly string[]).includes(value);
}
export type SidebarState = "expanded" | "collapsed";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export const isAmbient = isAmbientId;

export function isMotion(value: unknown): value is Motion {
  return typeof value === "string" && (MOTIONS as readonly string[]).includes(value);
}

/** The plain interfaces' backgrounds (Clair, Sombre); the browser bar matches. */
export const PLAIN_BACKGROUND = { dark: "#09090b", light: "#f7f7f9" } as const;

/** The browser bar colour for a choice. */
export function themeColor(theme: Theme, ambient: Ambient, scheme: "dark" | "light"): string {
  if (theme === "atmosphere") return paletteOf(ambient).colors.base;
  return PLAIN_BACKGROUND[scheme];
}

/** One year, like the language. */
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The scheme shown for a choice: Atmosphère takes its palette's (light or dark glass); "system"
 * follows the device (dark is assumed until the page runs, then SCHEME_SCRIPT corrects it).
 */
export function resolveScheme(theme: Theme, ambient: Ambient, prefersLight = false): "dark" | "light" {
  if (theme === "atmosphere") return paletteOf(ambient).scheme;
  if (theme === "system") return prefersLight ? "light" : "dark";
  return theme;
}

/**
 * Runs in <head> before the first paint:
 * - with "system", shows the device's scheme at once and follows it when it changes (e.g. at sunset);
 * - a device that draws without a graphics chip (software rendering, common in virtual machines and
 *   remote desktops) is marked low-power at once, so it never pays for bending glass and motion
 *   (see components/appearance/performance-guard.ts, which also checks the frame rate and may turn
 *   off only the glass's bending: data-glass="flat"). The verdicts are kept for the tab.
 */
export const SCHEME_SCRIPT = `(function(){var d=document.documentElement;try{var m=matchMedia("(prefers-color-scheme: light)");var a=function(){if(d.dataset.theme==="system")d.dataset.scheme=m.matches?"light":"dark"};a();m.addEventListener("change",a)}catch(e){}try{if(sessionStorage.getItem("cendr-glass")==="flat")d.dataset.glass="flat";var k="cendr-gpu",v=sessionStorage.getItem(k);if(v==="low"){d.dataset.perf="low"}else if(!v){var c=document.createElement("canvas"),g=c.getContext("webgl"),r="";if(g){var x=g.getExtension("WEBGL_debug_renderer_info");r=String(g.getParameter(x?x.UNMASKED_RENDERER_WEBGL:g.RENDERER));var l=g.getExtension("WEBGL_lose_context");if(l)l.loseContext()}if(!g||/swiftshader|llvmpipe|softpipe|software|basic render/i.test(r)){d.dataset.perf="low";sessionStorage.setItem(k,"low")}}}catch(e){}})();`;
