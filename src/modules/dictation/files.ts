/** Voice dictation limits (CLAUDE.md §11). One recording is at most a few minutes of speech. */
export const DICTATION_MAX_SECONDS = 300;
export const DICTATION_MAX_BYTES = 12 * 1024 * 1024;

export const DICTATION_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"] as const;
export type DictationType = (typeof DICTATION_TYPES)[number];

/** Recognises a recording by its first bytes, never by its name or the type the browser claims. */
export function sniffAudioType(bytes: Uint8Array): DictationType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") return "audio/mp4";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (bytes.length >= 3 && (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return "audio/mpeg";
  return null;
}

/** Credits for a recording: the per-minute rate set by our team, to the hundredth, at least one second. */
export function dictationCredits(seconds: number, creditsPerMinute: number): number {
  const billed = Math.min(Math.max(seconds, 1), DICTATION_MAX_SECONDS);
  return Math.round((billed / 60) * creditsPerMinute * 100) / 100;
}

export const DICTATION_ERRORS = ["invalid_audio", "too_large", "too_long", "quota", "failed", "not_configured", "disabled", "forbidden", "empty"] as const;
export type DictationError = (typeof DICTATION_ERRORS)[number];
