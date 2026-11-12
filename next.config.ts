import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content Security Policy: our own scripts, and network access only to our site and our Supabase
// project (database, storage, real time). Images, sound and video from elsewhere are refused, so a
// planted instruction cannot make a page send data to an outside server.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
// The knowledge import's tutorial video (IMPORT_TUTORIAL_VIDEO_URL): only its own host is let in.
const tutorialVideo = (() => {
  try {
    const url = new URL(process.env.IMPORT_TUTORIAL_VIDEO_URL ?? "");
    if (url.protocol !== "https:") return { media: "", frame: "" };
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname)) return { media: "", frame: " https://www.youtube-nocookie.com" };
    if (/(^|\.)vimeo\.com$/.test(url.hostname)) return { media: "", frame: " https://player.vimeo.com" };
    return { media: ` ${url.origin}`, frame: "" };
  } catch {
    return { media: "", frame: "" };
  }
})();
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseOrigin}`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace(/^http/, "ws")}`,
  `media-src 'self' blob: ${supabaseOrigin}${tutorialVideo.media}`,
  `frame-src 'self' blob: data:${tutorialVideo.frame}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // Almost every screen is per-user and permission-filtered, so pages render at request time
  // (the previous caching model) rather than with Cache Components. See docs/ARCHITECTURE.md §11.
  poweredByHeader: false,
  // pdfkit reads its font files from its own folder at run time: it must not be bundled.
  serverExternalPackages: ["pdfkit"],
  // The Library became "Applis" (CLAUDE.md §11): old links keep working.
  async redirects() {
    return [
      { source: "/library", destination: "/apps", permanent: true },
      { source: "/library/:id", destination: "/apps/:id", permanent: true },
      // Scale became Studio (2026-11-11): its documents are in Knowledge, its projects on the Roadmap.
      { source: "/scale/strategy/:id", destination: "/studio/knowledge/:id", permanent: true },
      { source: "/scale/strategy", destination: "/studio/knowledge", permanent: true },
      { source: "/scale/:section(roadmap|projects)/:rest*", destination: "/studio/roadmap", permanent: true },
      { source: "/scale/:rest*", destination: "/studio", permanent: true },
    ];
  },
  // The Motion Design preview's open-source files, copied by scripts/copy-vendor.mjs (read at run time).
  outputFileTracingIncludes: { "/api/render/vendor/[name]": ["./.vendor/**"] },
  // The Tailwind loader's output was served from Turbopack's file-system cache after globals.css changed
  // (stale design tokens in dev and in production builds, seen at Step 11). Correctness first: no FS cache.
  experimental: {
    turbopackFileSystemCacheForBuild: false,
    turbopackFileSystemCacheForDev: false,
    // Going back to a page seen less than 30 s ago is instant (the browser keeps it); any change made in
    // the app (server actions) refreshes it, and conversations update in real time.
    staleTimes: { dynamic: 30 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
