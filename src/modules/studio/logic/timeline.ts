import { addDays, addMonths, diffDays } from "./dates";

/**
 * The roadmap's timeline: months across, one line per category, a milestone at its target date. Pure
 * geometry, so the screen and the tests agree on where a date is and which date a position means.
 */

export const ZOOMS = ["month", "quarter", "year"] as const;
export type Zoom = (typeof ZOOMS)[number];

/** Pixels per day: a month is about 300 px wide in the month view. */
export const DAY_PX: Record<Zoom, number> = { month: 10, quarter: 3.4, year: 1.25 };
/** Room a milestone card takes after its date (cards on one line never overlap). */
export const CARD_PX: Record<Zoom, number> = { month: 236, quarter: 196, year: 168 };
/** Months shown before today and at least after it. */
const PAD: Record<Zoom, [number, number]> = { month: [1, 5], quarter: [2, 11], year: [3, 23] };

export function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** From the first day of a month before the earliest date to the last day of a month after the latest. */
export function timelineRange(dates: (string | null | undefined)[], today: string, zoom: Zoom): { start: string; end: string } {
  const known = dates.filter((d): d is string => Boolean(d)).sort();
  const [before, after] = PAD[zoom];
  const from = [addMonths(firstOfMonth(today), -before), known[0] ? addMonths(firstOfMonth(known[0]), -1) : null].filter(Boolean).sort()[0]!;
  const lastKnown = known[known.length - 1];
  const to = [addMonths(firstOfMonth(today), after + 1), lastKnown ? addMonths(firstOfMonth(lastKnown), 2) : null].filter(Boolean).sort().reverse()[0]!;
  return { start: from, end: addDays(to, -1) };
}

export function xOf(date: string, start: string, zoom: Zoom): number {
  return diffDays(start, date) * DAY_PX[zoom];
}

/** The date at a horizontal position (rounded to the day, never before the start). */
export function dateAt(x: number, start: string, zoom: Zoom): string {
  return addDays(start, Math.max(0, Math.round(x / DAY_PX[zoom])));
}

export function widthOf(start: string, end: string, zoom: Zoom): number {
  return (diffDays(start, end) + 1) * DAY_PX[zoom];
}

/** The first day of every month in the range, with its position. */
export function monthTicks(start: string, end: string, zoom: Zoom): { iso: string; x: number; width: number }[] {
  const out: { iso: string; x: number; width: number }[] = [];
  for (let m = firstOfMonth(start); m <= end; m = addMonths(m, 1)) {
    const next = addMonths(m, 1);
    out.push({ iso: m, x: xOf(m, start, zoom), width: diffDays(m, next) * DAY_PX[zoom] });
  }
  return out;
}

/**
 * Lines inside a category so cards never overlap: each card goes on the first line where the previous
 * card has ended. Returns the line of each item and how many lines are needed.
 */
export function packRows<T extends { id: string; x: number }>(items: T[], width: number, gap = 12): { row: Map<string, number>; rows: number } {
  const ends: number[] = [];
  const row = new Map<string, number>();
  for (const item of [...items].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))) {
    let r = ends.findIndex((end) => end + gap <= item.x);
    if (r === -1) {
      r = ends.length;
      ends.push(0);
    }
    ends[r] = item.x + width;
    row.set(item.id, r);
  }
  return { row, rows: Math.max(1, ends.length) };
}
