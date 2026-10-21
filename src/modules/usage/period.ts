/** Usage periods are calendar months in UTC, like monthly credits ("2026-10"). */

/** The current month and the ones before it, newest first. */
export function recentMonths(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** The chosen month among `months` (the first one when the choice is not offered), with its bounds. */
export function monthRange(chosen: unknown, months: string[]): { key: string; from: Date; to: Date; current: boolean } {
  const key = typeof chosen === "string" && months.includes(chosen) ? chosen : months[0];
  const [y, m] = key.split("-").map(Number);
  return { key, from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)), current: key === months[0] };
}

/** Every day of the month as "YYYY-MM-DD", for charts that show days without activity too. */
export function daysOf(from: Date, to: Date): string[] {
  return Array.from({ length: Math.round((to.getTime() - from.getTime()) / 86_400_000) }, (_, i) =>
    new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );
}
