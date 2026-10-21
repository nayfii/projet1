import { readFile } from "node:fs/promises";
import path from "node:path";
import { memberOrNull } from "@/lib/auth/guards";

export const runtime = "nodejs";

/**
 * The open-source files a Motion Design preview needs (GSAP, the HyperFrames runtime, the Inter font),
 * served from our own server so the preview never loads anything from elsewhere. The browser inlines
 * them into the sandboxed preview. Versions are pinned in package.json and part of the file names.
 */
const FILES: Record<string, { file: string; type: string }> = {
  "gsap-3.15.0.js": { file: "gsap/dist/gsap.min.js", type: "text/javascript; charset=utf-8" },
  "hyperframes-runtime-0.8.134.js": { file: "@hyperframes/core/dist/hyperframe.runtime.iife.js", type: "text/javascript; charset=utf-8" },
  "inter-latin-5.3.0.woff2": { file: "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", type: "font/woff2" },
  "inter-latin-ext-5.3.0.woff2": { file: "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2", type: "font/woff2" },
};

export async function GET(_request: Request, ctx: RouteContext<"/api/render/vendor/[name]">) {
  if (!(await memberOrNull())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { name } = await ctx.params;
  const entry = FILES[name];
  if (!entry) return Response.json({ error: "not_found" }, { status: 404 });
  const body = await readFile(path.join(process.cwd(), "node_modules", entry.file));
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": entry.type, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
