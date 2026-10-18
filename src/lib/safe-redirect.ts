/** Only same-site paths are allowed as redirect targets (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, appUrl: string): string {
  if (!next) return "/";
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) return next;
  try {
    const target = new URL(next);
    const app = new URL(appUrl);
    if (target.origin === app.origin) return target.pathname + target.search;
  } catch {
    // not a URL
  }
  return "/";
}
