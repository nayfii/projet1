import { formatOfSize, MAX_RENDER_SECONDS, type VideoFormat } from "./formats";

/**
 * Motion Design (CLAUDE.md §4.7): the model writes a HyperFrames composition (HTML, CSS and a GSAP
 * timeline) in a fenced block whose language is `hyperframes`. This module finds it, checks what the
 * render needs, and prepares it for the browser preview or the worker. AI-written code is untrusted:
 * it only ever runs in a sandboxed iframe (preview) or in the worker's headless browser, behind a
 * Content-Security-Policy that blocks every outside request.
 */

export const COMPOSITION_LANG = "hyperframes";
const BLOCK = /```hyperframes[^\n]*\n([\s\S]*?)```/g;
export const MAX_COMPOSITION_CHARS = 120_000;

/** The last composition of an answer (an answer may show a draft before the final one). */
export function extractComposition(markdown: string): string | null {
  const blocks = [...markdown.matchAll(BLOCK)];
  const html = blocks.at(-1)?.[1]?.trim();
  return html ? html : null;
}

export type CompositionInfo = {
  id: string;
  format: VideoFormat;
  width: number;
  height: number;
  /** Seconds, as declared on the composition. */
  duration: number;
  /** Files the composition uses, by name (`assets/logo.png` → `logo.png`). */
  assets: string[];
};

export type CompositionProblem = "too_large" | "no_composition" | "unsupported_size" | "no_duration" | "too_long" | "no_timeline";

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] ?? null;
const ASSET = /(["'(])assets\/([A-Za-z0-9][A-Za-z0-9._ -]{0,120})(?=["')])/g;

export function inspectComposition(html: string): { ok: true; info: CompositionInfo } | { ok: false; problems: CompositionProblem[] } {
  if (html.length > MAX_COMPOSITION_CHARS) return { ok: false, problems: ["too_large"] };
  const meta = /<meta\b[^>]*\sdata-composition-id\s*=[^>]*>/i.exec(html)?.[0];
  if (!meta) return { ok: false, problems: ["no_composition"] };
  const problems: CompositionProblem[] = [];
  const id = attr(meta, "data-composition-id") ?? "";
  const width = Number(attr(meta, "data-width"));
  const height = Number(attr(meta, "data-height"));
  const format = formatOfSize(width, height);
  if (!format) problems.push("unsupported_size");
  const duration = Number(attr(meta, "data-duration"));
  if (!Number.isFinite(duration) || duration <= 0) problems.push("no_duration");
  else if (duration > MAX_RENDER_SECONDS.motion) problems.push("too_long");
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!id || !new RegExp(`__timelines\\s*\\[\\s*["'\`]${escaped}["'\`]\\s*\\]\\s*=`).test(html)) problems.push("no_timeline");
  if (problems.length) return { ok: false, problems };
  const assets = [...new Set([...html.matchAll(ASSET)].map((m) => m[2]))];
  return { ok: true, info: { id, format: format!, width, height, duration, assets } };
}

/** Content-Security-Policy of a composition: nothing from outside (preview), only its own folder (worker). */
export function compositionCsp(mode: "preview" | "render"): string {
  const own = mode === "preview" ? "" : " 'self'";
  return [
    `default-src 'none'`,
    `script-src${own} 'unsafe-inline'`,
    `style-src${own} 'unsafe-inline'`,
    `img-src${own} data: blob:`,
    `media-src${own} data: blob:`,
    `font-src${own} data:`,
    `connect-src${own || " 'none'"}`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join("; ");
}

const inlineScript = (code: string) => `<script>${code.replace(/<\/script/gi, "<\\/script")}</script>`;

export type PrepareOptions = {
  mode: "preview" | "render";
  /** Preview: the GSAP code, inlined. Render: ignored (the worker copies gsap.min.js next to the file). */
  gsap?: string;
  /** Preview only: the HyperFrames runtime, inlined (the worker's renderer injects its own). */
  runtime?: string;
  /** @font-face rules for the fonts the platform provides. */
  fontCss: string;
  /** Where a named asset is read from (preview: a data URL; render: the file copied next to the composition). */
  assetUrl: (name: string) => string | null;
};

/**
 * The composition as it is played or rendered: its own scripts, links and policies removed, then our
 * policy, fonts and libraries placed first in the page, and asset names replaced by their files.
 */
export function prepareComposition(html: string, options: PrepareOptions): string {
  let doc = html
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script\s*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "");
  doc = doc.replace(ASSET, (whole, quote: string, name: string) => {
    const url = options.assetUrl(name);
    return url ? `${quote}${url}` : whole;
  });
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${compositionCsp(options.mode)}">`,
    `<style>${options.fontCss}</style>`,
    options.mode === "preview" ? inlineScript(options.gsap ?? "") : `<script src="gsap.min.js"></script>`,
    ...(options.mode === "preview" && options.runtime ? [inlineScript(options.runtime)] : []),
  ].join("");
  if (/<head\b[^>]*>/i.test(doc)) return doc.replace(/<head\b[^>]*>/i, (tag) => `${tag}${head}`);
  if (/<html\b[^>]*>/i.test(doc)) return doc.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${doc}</body></html>`;
}

/** The fonts offered to compositions (the same files in the preview and in the worker). */
export const FONT_FAMILY = "Inter";
export function fontCss(src: { latin: string; latinExt: string }): string {
  const face = (url: string, range: string) =>
    `@font-face{font-family:"${FONT_FAMILY}";font-style:normal;font-display:block;font-weight:100 900;src:url(${url}) format("woff2");unicode-range:${range}}`;
  return [
    face(src.latin, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"),
    face(src.latinExt, "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"),
  ].join("");
}
