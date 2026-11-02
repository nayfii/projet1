import { describe, expect, it } from "vitest";
import { DICTATION_MAX_SECONDS, dictationCredits, sniffAudioType } from "@/modules/dictation/files";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("dictation recordings", () => {
  it("are recognised by their first bytes, not by what the browser claims", () => {
    expect(sniffAudioType(bytes([0x1a, 0x45, 0xdf, 0xa3], "rest"))).toBe("audio/webm");
    expect(sniffAudioType(bytes("OggS", [0, 2]))).toBe("audio/ogg");
    expect(sniffAudioType(bytes([0, 0, 0, 0x20], "ftypM4A "))).toBe("audio/mp4");
    expect(sniffAudioType(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "))).toBe("audio/wav");
    expect(sniffAudioType(bytes("ID3", [4, 0]))).toBe("audio/mpeg");
    expect(sniffAudioType(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffAudioType(bytes("<html>"))).toBeNull();
  });

  it("cost the per-minute rate set by our team, at least one second, at most the limit", () => {
    expect(dictationCredits(60, 2)).toBe(2);
    expect(dictationCredits(30, 2)).toBe(1);
    expect(dictationCredits(0, 2)).toBe(0.03);
    expect(dictationCredits(DICTATION_MAX_SECONDS * 10, 2)).toBe(10);
    expect(dictationCredits(45, 0)).toBe(0);
  });
});
