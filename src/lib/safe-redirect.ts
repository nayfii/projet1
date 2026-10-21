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

/**
 * Our email templates end their links with `next={{ .RedirectTo }}`, inserted as is: when the
 * destination has its own query (`/auth/callback?via=email&next=%2Finvite%2Fx`), everything after
 * the first `next=` belongs to it. Check the result with safeNextPath.
 */
export function trailingNextParam(search: string): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const at = query.startsWith("next=") ? 0 : query.indexOf("&next=") + 1;
  if (at === 0 && !query.startsWith("next=")) return null;
  const raw = query.slice(at + "next=".length);
  if (!raw) return null;
  return raw.startsWith("http") || raw.startsWith("/") ? raw : decodeURIComponent(raw);
}
