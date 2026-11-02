import release from "../../release.json";

/**
 * The product version, written by the launch workflow into release.json (v1.0, v1.1, …). Built into
 * the app, so every page shows the version that is actually running.
 */
export const APP_VERSION = `v${release.version}`;
export const RELEASE_DATE = release.date;
export const RELEASE_NOTES = release.notes;

/** The next version after `current` (same rule as scripts/release/version.mjs): "1.9" → "1.10". */
export function nextVersion(current: string): string {
  const match = /^v?(\d+)\.(\d+)$/.exec(current.trim());
  if (!match) return "1.1";
  return `${Number(match[1])}.${Number(match[2]) + 1}`;
}
