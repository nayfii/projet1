// Version numbers of the product: "1.0", "1.1", … "1.9", "1.10" (shown as v1.0, v1.1, …).
// Shared by the launch workflow (scripts/release/bump.mjs) and checked by the unit tests.

/** The next version after `current`: the second number goes up by one. */
export function nextVersion(current) {
  const match = /^v?(\d+)\.(\d+)$/.exec(String(current ?? "").trim());
  if (!match) return "1.1";
  return `${Number(match[1])}.${Number(match[2]) + 1}`;
}
