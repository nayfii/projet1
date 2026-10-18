import { describe, expect, it } from "vitest";
import fr from "../../messages/fr.json";
import en from "../../messages/en.json";
import { localeFromAcceptLanguage } from "@/i18n/config";
import { ERROR_CODES } from "@/lib/errors";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("translations", () => {
  it("has exactly the same keys in French and English", () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });

  it("has no empty translation", () => {
    const empty = (obj: object): string[] =>
      keys(obj).filter((k) => {
        const value = k.split(".").reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], obj);
        return typeof value !== "string" || value.trim() === "";
      });
    expect(empty(fr)).toEqual([]);
    expect(empty(en)).toEqual([]);
  });

  it("translates every error code the database can raise", () => {
    for (const code of ERROR_CODES) {
      expect(fr.errors).toHaveProperty(code);
      expect(en.errors).toHaveProperty(code);
    }
  });
});

describe("browser language detection", () => {
  it.each([
    ["fr-FR,fr;q=0.9,en;q=0.8", "fr"],
    ["en-GB,en;q=0.9", "en"],
    ["de-DE,de;q=0.9,en;q=0.5,fr;q=0.7", "fr"],
    ["es-ES", null],
    [null, null],
  ])("%s → %s", (header, expected) => {
    expect(localeFromAcceptLanguage(header)).toBe(expected);
  });
});
