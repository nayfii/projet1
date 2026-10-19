import { CATEGORY_PRIORITY, type HideCounts, type Span } from "./categories";

/** Removes overlaps: the longest passage wins, then the most specific category. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans
    .filter((s) => s.end > s.start)
    .sort((a, b) => b.end - b.start - (a.end - a.start) || CATEGORY_PRIORITY[b.category] - CATEGORY_PRIORITY[a.category] || a.start - b.start);
  const kept: Span[] = [];
  for (const s of sorted) if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
  return kept.sort((a, b) => a.start - b.start);
}

export function countByCategory(spans: Span[]): HideCounts {
  const counts: HideCounts = {};
  for (const s of spans) counts[s.category] = (counts[s.category] ?? 0) + 1;
  return counts;
}
