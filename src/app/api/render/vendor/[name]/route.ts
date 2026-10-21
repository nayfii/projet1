import { readFile } from "node:fs/promises";
import path from "node:path";
import { memberOrNull } from "@/lib/auth/guards";

export const runtime = "nodejs";

/**
 * The open-source files a Motion Design preview needs (GSAP, the HyperFrames runtime, the Inter font),
 * served from our own server so the preview never loads anything from elsewhere. The browser inlines
 * them into the sandboxed preview. Versions are pinned in package.json and part of the file names.
 * scripts/copy-vendor.mjs copies them into .vendor/ before dev and build (shipped with this route).
 */
const FILES: Record<string, string> = {
  "gsap-3.15.0.js": "text/javascript; charset=utf-8",
  "hyperframes-runtime-0.8.134.js": "text/javascript; charset=utf-8",
  "inter-latin-5.3.0.woff2": "font/woff2",
  "inter-latin-ext-5.3.0.woff2": "font/woff2",
};

export async function GET(_request: Request, ctx: RouteContext<"/api/render/vendor/[name]">) {
  if (!(await memberOrNull())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { name } = await ctx.params;
  const type = Object.hasOwn(FILES, name) ? FILES[name] : undefined;
  if (!type) return Response.json({ error: "not_found" }, { status: 404 });
  const body = await readFile(path.join(process.cwd(), ".vendor", name));
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
