import { describe, expect, it } from "vitest";
import { DEFAULT_AUTO_CATEGORIES, type HideCategory, type Span } from "@/modules/hide/categories";
import { detectSensitive, type DetectionLists } from "@/modules/hide/detect";
import { detectAmounts, detectCards, detectEmails, detectIbans, ibanChecksumValid, luhnValid } from "@/modules/hide/detectors/patterns";
import { detectPhones } from "@/modules/hide/detectors/phone";
import { detectPersons } from "@/modules/hide/detectors/person";
import { detectListTerms } from "@/modules/hide/detectors/lists";
import { applyPlaceholders, autoSpans, canonicalValue, restorePlaceholders, spansToMask, StreamRestorer } from "@/modules/hide/mask";
import { extractDocument } from "@/modules/documents/server/extract";
import { minimalPdf } from "../helpers/pdf";

const values = (text: string, spans: Span[]) => spans.map((s) => text.slice(s.start, s.end));
const NO_LISTS: DetectionLists = { terms: [], firstNames: [] };
const LISTS: DetectionLists = {
  terms: [
    { term: "Client A", category: "client" },
    { term: "Société Générale", category: "client" },
    { term: "Projet Phoenix", category: "project" },
    { term: "Nathalie Petit", category: "person" },
  ],
  firstNames: ["Nathalie"],
};

describe("IBAN (mod 97)", () => {
  it("finds valid IBANs, grouped or not, and rejects a wrong checksum", () => {
    const text = "Virement sur FR76 3000 6000 0112 3456 7890 189 pour la facture. Ancien compte : DE89370400440532013000. Faux : FR76 3000 6000 0112 3456 7890 188.";
    expect(values(text, detectIbans(text))).toEqual(["FR76 3000 6000 0112 3456 7890 189", "DE89370400440532013000"]);
    expect(ibanChecksumValid("GB29 NWBK 6016 1331 9268 19")).toBe(true);
    expect(ibanChecksumValid("BE68 5390 0754 7034")).toBe(true);
    expect(ibanChecksumValid("BE68 5390 0754 7035")).toBe(false);
  });

  it("does not swallow the following word", () => {
    const text = "IBAN FR7630006000011234567890189 merci";
    expect(values(text, detectIbans(text))).toEqual(["FR7630006000011234567890189"]);
  });
});

describe("card numbers (Luhn)", () => {
  it("finds Visa, Mastercard and Amex numbers, not random digits", () => {
    const text = "Carte 4111 1111 1111 1111, MC 5555-5555-5555-4444, Amex 378282246310005. Commande 4111 1111 1111 1112.";
    expect(values(text, detectCards(text))).toEqual(["4111 1111 1111 1111", "5555-5555-5555-4444", "378282246310005"]);
    expect(luhnValid("79927398713")).toBe(true);
  });
});

describe("emails and phone numbers", () => {
  it("finds emails", () => {
    const text = "Écrire à nathalie.petit@acme-conseil.fr ou à j.smith+factures@example.co.uk.";
    expect(values(text, detectEmails(text))).toEqual(["nathalie.petit@acme-conseil.fr", "j.smith+factures@example.co.uk"]);
  });

  it("finds French, British and American phone numbers", () => {
    const text = "Appelle-moi au 06 12 34 56 78, au +33 1 23 45 67 89 ou au 01.23.45.67.89. London: +44 20 7946 0958. SF office: (415) 555-2671.";
    expect(values(text, detectPhones(text)).sort()).toEqual(["(415) 555-2671", "+33 1 23 45 67 89", "+44 20 7946 0958", "01.23.45.67.89", "06 12 34 56 78"].sort());
  });

  it("does not take dates, years or order numbers for phone numbers", () => {
    expect(detectPhones("Réunion le 12/10/2026 à 14h, commande n° 2024-118, année 2025.")).toEqual([]);
  });
});

describe("amounts", () => {
  it("finds French and English amounts", () => {
    const text = "Devis de 1 250,50 € HT, acompte de €1,250.50, budget 3 500 euros, levée de $2.5M, 12 k€ de marge, EUR 900 et 2 millions d'euros.";
    expect(values(text, detectAmounts(text))).toEqual(["1 250,50 €", "€1,250.50", "3 500 euros", "$2.5M", "12 k€", "EUR 900", "2 millions d'euros"]);
  });

  it("ignores percentages, years and plain numbers", () => {
    expect(detectAmounts("Remise de 12 % en 2026, page 3, 45 jours.")).toEqual([]);
  });
});

describe("person names (local, French and English)", () => {
  const cases: [string, string[]][] = [
    ["Envoie le contrat à Jean Dupont avant vendredi.", ["Jean Dupont"]],
    ["Mme Martin a appelé, M. Lefèvre rappellera.", ["Martin", "Lefèvre"]],
    ["Rendez-vous avec Pierre-Yves Le Goff chez Orange.", ["Pierre-Yves Le Goff"]],
    ["Contrat signé par Jean DUPONT.", ["Jean DUPONT"]],
    ["Please send the contract to John Smith before Friday.", ["John Smith"]],
    ["Meeting with Dr. Emily Watson tomorrow.", ["Emily Watson"]],
    ["Demande à Nathalie, elle connaît le dossier.", ["Nathalie"]],
  ];
  it.each(cases)("%s", (text, expected) => {
    const found = values(text, detectSensitive(text, NO_LISTS).filter((s) => s.category === "person"));
    expect(found).toEqual(expected);
  });

  it("does not take ordinary words for names", () => {
    for (const text of ["Will you send the file today?", "Le budget est validé pour le trimestre.", "Claire et nette, la proposition a plu."]) {
      expect(detectPersons(text)).toEqual([]);
    }
  });

  it("uses the employees' first names", () => {
    const text = "Voir avec Thibaud demain.";
    expect(values(text, detectPersons(text, ["Thibaud"]))).toEqual(["Thibaud"]);
  });
});

describe("company lists", () => {
  it("matches clients and custom terms without accents or capitals", () => {
    const text = "Point sur societe generale et sur le projet phoenix.";
    expect(values(text, detectListTerms(text, LISTS.terms))).toEqual(["societe generale", "projet phoenix"]);
  });

  it("does not take 'le client a payé' for the client 'Client A'", () => {
    expect(detectListTerms("Le client a payé hier.", LISTS.terms)).toEqual([]);
    const text = "Le dossier Client A avance.";
    expect(values(text, detectListTerms(text, LISTS.terms))).toEqual(["Client A"]);
  });
});

describe("detectSensitive: everything together, without overlaps", () => {
  it("keeps the most specific passage when detections overlap", () => {
    const text = "Contact : nathalie.petit@acme.fr (Nathalie Petit) pour Client A, IBAN FR76 3000 6000 0112 3456 7890 189.";
    const spans = detectSensitive(text, LISTS);
    expect(spans.map((s) => [text.slice(s.start, s.end), s.category])).toEqual([
      ["nathalie.petit@acme.fr", "email"],
      ["Nathalie Petit", "person"],
      ["Client A", "client"],
      ["FR76 3000 6000 0112 3456 7890 189", "iban"],
    ]);
  });
});

describe("modes and placeholders", () => {
  const text = "Olivier, verse 1 200 € sur FR76 3000 6000 0112 3456 7890 189 pour Client A.";
  const detected = detectSensitive(text, LISTS);
  const auto = new Set(DEFAULT_AUTO_CATEGORIES);
  const numbering = () => {
    const seen = new Map<string, string>();
    const next = new Map<HideCategory, number>();
    return (category: HideCategory, value: string) => {
      const key = `${category}:${canonicalValue(category, value)}`;
      if (!seen.has(key)) {
        next.set(category, (next.get(category) ?? 0) + 1);
        seen.set(key, `[${category.toUpperCase()}_${next.get(category)}]`);
      }
      return seen.get(key)!;
    };
  };

  it("Automatic masks the company's categories (amounts stay visible by default)", () => {
    const spans = spansToMask(text, detected, auto, { modes: ["automatic"], blur: [], unblur: [] });
    const { masked, counts } = applyPlaceholders(text, spans, numbering());
    expect(masked).toBe("[PERSON_1], verse 1 200 € sur [IBAN_1] pour [CLIENT_1].");
    expect(counts).toEqual({ person: 1, iban: 1, client: 1 });
  });

  it("Manual: blurred passages are masked, unblurred ones stay visible", () => {
    const spans = spansToMask(text, detected, auto, { modes: ["automatic", "manual"], blur: ["1 200 €", "verse"], unblur: ["Olivier"] });
    const { masked } = applyPlaceholders(text, spans, numbering());
    expect(masked).toBe("Olivier, [REDACTED_1] [AMOUNT_1] sur [IBAN_1] pour [CLIENT_1].");
  });

  it("Manual alone masks only what the person blurred", () => {
    const spans = spansToMask(text, detected, auto, { modes: ["manual"], blur: ["Client A"], unblur: [] });
    expect(applyPlaceholders(text, spans, numbering()).masked).toBe("Olivier, verse 1 200 € sur FR76 3000 6000 0112 3456 7890 189 pour [CLIENT_1].");
  });

  it("gives the same placeholder to the same value written differently", () => {
    const t = "FR76 3000 6000 0112 3456 7890 189 puis FR7630006000011234567890189";
    const { masked } = applyPlaceholders(t, detectIbans(t), numbering());
    expect(masked).toBe("[IBAN_1] puis [IBAN_1]");
  });
});

describe("restoring real values", () => {
  const mapping = new Map([
    ["[CLIENT_1]", "Client A"],
    ["[IBAN_1]", "FR76 3000 6000 0112 3456 7890 189"],
  ]);

  it("restores known placeholders and leaves citations and unknown placeholders alone", () => {
    expect(restorePlaceholders("Pour [CLIENT_1] [S1], virer sur [IBAN_1] (pas [IBAN_9]).", mapping)).toBe(
      "Pour Client A [S1], virer sur FR76 3000 6000 0112 3456 7890 189 (pas [IBAN_9]).",
    );
  });

  it("restores placeholders that arrive in pieces while streaming", () => {
    const restorer = new StreamRestorer(mapping);
    const pieces = ["Bonjour [CLI", "ENT_", "1], votre IBAN [", "IBAN_1] est noté [S", "1]."];
    const out = pieces.map((p) => restorer.push(p)).join("") + restorer.flush();
    expect(out).toBe("Bonjour Client A, votre IBAN FR76 3000 6000 0112 3456 7890 189 est noté [S1].");
  });
});

describe("Documents mode: text read from a file is masked like a message", () => {
  it("masks an IBAN and a phone number inside a PDF", async () => {
    const pdf = minimalPdf("Facture 2026-118 pour Client A", "IBAN : FR76 3000 6000 0112 3456 7890 189", "Contact : 06 12 34 56 78");
    const { text } = await extractDocument(pdf, "pdf", 40_000);
    const spans = spansToMask(text, detectSensitive(text, LISTS), new Set(DEFAULT_AUTO_CATEGORIES), { modes: ["automatic"], blur: [], unblur: [] });
    const { masked, counts } = applyPlaceholders(text, spans, (c) => `[${c.toUpperCase()}_1]`);
    expect(masked).not.toContain("FR76");
    expect(masked).not.toContain("06 12 34 56 78");
    expect(masked).toContain("[IBAN_1]");
    expect(masked).toContain("[PHONE_1]");
    expect(counts).toMatchObject({ iban: 1, phone: 1, client: 1 });
  });
});

describe("long documents", () => {
  it("scans a 40,000-character document quickly", () => {
    const paragraph = "Le 12 mars, Jean Dupont (jean.dupont@acme.fr, 06 12 34 56 78) a validé le devis de 1 250 € pour Client A. IBAN FR76 3000 6000 0112 3456 7890 189. ";
    const text = paragraph.repeat(Math.ceil(40_000 / paragraph.length)).slice(0, 40_000);
    const started = performance.now();
    const spans = detectSensitive(text, LISTS);
    const elapsed = performance.now() - started;
    expect(spans.filter((s) => s.category === "iban").length).toBeGreaterThan(200);
    expect(elapsed).toBeLessThan(5_000);
  });
});

describe("restoring in a group conversation", () => {
  it("restores only the placeholders the model was shown", async () => {
    const { createEphemeralMasker } = await import("@/modules/hide/server/masker");
    const masker = createEphemeralMasker(LISTS);
    const text = "Client A, IBAN FR76 3000 6000 0112 3456 7890 189";
    const [{ masked }] = await masker.mask([{ text, spans: autoSpans(detectSensitive(text, LISTS), new Set(DEFAULT_AUTO_CATEGORIES)) }]);
    expect(masked).toBe("[CLIENT_1], IBAN [IBAN_1]");
    const restorer = masker.restorer(new Set(["[CLIENT_1]"]));
    expect(restorer.push("Pour [CLIENT_1], l'IBAN est [IBAN_1].") + restorer.flush()).toBe("Pour Client A, l'IBAN est [IBAN_1].");
    const all = masker.restorer();
    expect(all.push("[IBAN_1]") + all.flush()).toBe("FR76 3000 6000 0112 3456 7890 189");
  });
});

describe("AI mentions are not sensitive", () => {
  it("leaves @Claude, @ChatGPT, @Gemini and @IA alone, but not a colleague named Claude", () => {
    const text = "@Claude et @IA, demandez à Claude Bernard ; @ChatGPT puis @Gemini";
    const found = values(text, detectSensitive(text, { terms: [], firstNames: ["Claude"] }));
    expect(found).toEqual(["Claude Bernard"]);
  });
});
