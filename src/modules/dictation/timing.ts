/**
 * Timing marks of one dictation, in the browser's own performance timeline: when the person clicked,
 * when the microphone really listened, when the first words showed, when they stopped, when the text
 * was in the box (and when the polished version replaced it). Durations only, never any content:
 * read by the speed tests (e2e/dictation-speed.spec.ts) and visible in the browser's performance tools.
 */
export type DictationStep = "click" | "listening" | "first-text" | "stop" | "text" | "polished";

export function markDictation(step: DictationStep): void {
  try {
    performance.mark(`cendr:dictation:${step}`);
  } catch {
    // No performance timeline (very old browser): nothing to measure.
  }
}

/** The server's own timings of one part (Server-Timing header): checks before the model, the model, total. */
export function serverTiming(parts: Record<string, number>): string {
  return Object.entries(parts)
    .map(([name, ms]) => `${name};dur=${Math.max(0, Math.round(ms))}`)
    .join(", ");
}
