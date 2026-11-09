/**
 * Only same-site paths are allowed as redirect targets (prevents open redirects).
 * The target is resolved the way the browser and `new URL` will resolve it, so tricks such as
 * "/\t/evil.com", "/\\evil.com" or "https://app//evil.com" end on the home page.
 */
export function safeNextPath(next: string | null | undefined, appUrl: string): string {
  if (!next || /[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  try {
    const app = new URL(appUrl);
    const target = new URL(next, app);
    if (target.origin !== app.origin) return "/";
    const path = target.pathname + target.search;
    return path.startsWith("//") ? "/" : path;
  } catch {
    return "/";
  }
}

/**
 * Where a sign-in lands: our team (platform admins) opens our console unless a precise page was asked
 * for, even when the same account also belongs to a company (a test company, for instance).
 */
export function landingPath(next: string, isPlatformAdmin: boolean): string {
  return isPlatformAdmin && next === "/" ? "/platform" : next;
}
