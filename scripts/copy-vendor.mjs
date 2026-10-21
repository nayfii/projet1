/**
 * Copies the open-source files of the Motion Design preview (GSAP, the HyperFrames runtime, the Inter
 * font) out of node_modules into .vendor/, as real files. Hosting platforms ship only the files the
 * server reads, and pnpm's package links are not always kept: plain copies always are.
 * Runs before `next dev` and `next build`. Names must match src/app/api/render/vendor/[name]/route.ts.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const FILES = {
  "gsap-3.15.0.js": "gsap/dist/gsap.min.js",
  "hyperframes-runtime-0.8.134.js": "@hyperframes/core/dist/hyperframe.runtime.iife.js",
  "inter-latin-5.3.0.woff2": "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  "inter-latin-ext-5.3.0.woff2": "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
};

const target = path.join(process.cwd(), ".vendor");
mkdirSync(target, { recursive: true });
for (const [name, file] of Object.entries(FILES)) {
  // Through node_modules/ (copying follows the links): some packages do not export these paths.
  copyFileSync(path.join(process.cwd(), "node_modules", file), path.join(target, name));
}
