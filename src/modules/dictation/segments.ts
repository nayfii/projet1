/**
 * Long dictation, cut into parts at the speaker's pauses: each part is transcribed while the person
 * keeps talking, so the text appears as they speak and is ready almost as soon as they stop.
 * Pure logic, fed with voice levels (RMS, 0–1) about every 60 ms; shared by the microphone and the tests.
 */
export const SEGMENT_RULES = {
  /** A part is at least this long (shorter parts transcribe worse and cost the one-second minimum). */
  minMs: 2_500,
  /** From this length, the next short pause ends the part. */
  maxMs: 15_000,
  /** Without any pause, a part ends here anyway. */
  hardMs: 22_000,
  /** A pause: this long below the quiet threshold… */
  pauseMs: 450,
  /** …a short one once the part is long. */
  shortPauseMs: 150,
  /** Quiet = below this share of the recent peak… */
  pauseRatio: 0.3,
  /** …and never above this absolute level (room noise). */
  floor: 0.006,
  /** A part whose loudest moment stays under this is silence: not sent. */
  silent: 0.004,
  /** How fast the recent peak fades, per sample. */
  decay: 0.98,
} as const;

export type Cutter = { startedAt: number; peak: number; loudest: number; quietSince: number | null };

export function newCutter(now: number): Cutter {
  return { startedAt: now, peak: 0, loudest: 0, quietSince: null };
}

/** One voice-level sample; true when the current part should end here. */
export function shouldCut(cutter: Cutter, level: number, now: number, rules: typeof SEGMENT_RULES = SEGMENT_RULES): boolean {
  cutter.peak = Math.max(level, cutter.peak * rules.decay);
  cutter.loudest = Math.max(cutter.loudest, level);
  const quiet = level < Math.max(rules.floor, cutter.peak * rules.pauseRatio);
  cutter.quietSince = quiet ? (cutter.quietSince ?? now) : null;
  const length = now - cutter.startedAt;
  if (length >= rules.hardMs) return true;
  if (length < rules.minMs || cutter.quietSince === null || isSilent(cutter, rules)) return false;
  return now - cutter.quietSince >= (length >= rules.maxMs ? rules.shortPauseMs : rules.pauseMs);
}

/** Nothing was said in this part. */
export function isSilent(cutter: Cutter, rules: typeof SEGMENT_RULES = SEGMENT_RULES): boolean {
  return cutter.loudest < rules.silent;
}

/** The voice level of a sample of the waveform (bytes centred on 128), 0–1. */
export function rmsLevel(samples: Uint8Array): number {
  let sum = 0;
  for (const v of samples) sum += ((v - 128) / 128) ** 2;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}
