import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A synthetic voice: 48 kHz mono 16-bit WAV, "phrases" of syllable-like bursts (a voiced sound with
 * harmonics, opening and closing four times a second) separated by short silences, like someone
 * dictating. Chromium loops it as the microphone.
 */
const PATTERNS: Record<"long-phrases" | "early-pause", [voiced: boolean, seconds: number][]> = {
  /** Phrases of about three seconds. */
  "long-phrases": [[true, 3.0], [false, 0.8], [true, 2.6], [false, 0.8], [true, 3.4], [false, 0.8], [true, 2.8], [false, 0.8], [true, 4.2], [false, 1.2]],
  /** A short opening ("Bonjour Marc,"), then longer phrases. */
  "early-pause": [[true, 1.4], [false, 0.6], [true, 3.2], [false, 0.7], [true, 2.4], [false, 0.7], [true, 3.6], [false, 0.8], [true, 2.8], [false, 1.2]],
};

export function syntheticVoice(variant: keyof typeof PATTERNS = "long-phrases"): string {
  // Outside test-results, which Playwright empties at the start of each run.
  const file = path.resolve(`node_modules/.cache/cendr-e2e/dictation-voice-${variant}.wav`);
  if (fs.existsSync(file)) return file;
  const rate = 48_000;
  const pattern = PATTERNS[variant];
  const total = Math.round(pattern.reduce((sum, [, s]) => sum + s, 0) * rate);
  const data = Buffer.alloc(total * 2);
  let seed = 7;
  const noise = () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  let i = 0;
  for (const [voiced, seconds] of pattern) {
    const n = Math.round(seconds * rate);
    for (let k = 0; k < n; k++, i++) {
      const t = k / rate;
      let v = 0;
      if (voiced) {
        const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t);
        const pitch = 140 + 20 * Math.sin(2 * Math.PI * 0.7 * t);
        v = syllable * (0.2 * Math.sin(2 * Math.PI * pitch * t) + 0.1 * Math.sin(4 * Math.PI * pitch * t) + 0.06 * Math.sin(2 * Math.PI * 720 * t) + 0.05 * noise());
        // Soft edges, like the start and end of a phrase.
        v *= Math.min(1, t / 0.05, (seconds - t) / 0.05);
      }
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32_000), i * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, data]));
  return file;
}
