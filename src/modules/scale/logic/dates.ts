/**
 * Calendar dates in Scale are plain "YYYY-MM-DD" strings (no time, no time zone), so a due date never
 * moves by a day when it is read in another zone. "Today" is taken in our zone (Europe/Paris) unless
 * another is given. Weeks start on Monday.
 */

export const SCALE_TIME_ZONE = "Europe/Paris";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function todayIso(timeZone = SCALE_TIME_ZONE, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * 86_400_000);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Monday of the week holding this date. */
export function weekStart(iso: string): string {
  const dow = new Date(toUtc(iso)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function inWeek(iso: string | null | undefined, monday: string): boolean {
  if (!iso) return false;
  const d = diffDays(monday, iso);
  return d >= 0 && d < 7;
}

/** Same day of the next month, kept within that month (31 January → 28 or 29 February). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
}

/** The 6 × 7 days shown for a month (Monday first), with the days of the next and previous months. */
export function monthGrid(year: number, month: number): string[] {
  const first = fromUtc(Date.UTC(year, month, 1));
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function monthOf(iso: string): { year: number; month: number } {
  const [y, m] = iso.split("-").map(Number);
  return { year: y, month: m - 1 };
}

export function minDate(...dates: (string | null | undefined)[]): string | null {
  const list = dates.filter((d): d is string => Boolean(d)).sort();
  return list[0] ?? null;
}

export function maxDate(...dates: (string | null | undefined)[]): string | null {
  const list = dates.filter((d): d is string => Boolean(d)).sort();
  return list[list.length - 1] ?? null;
}
