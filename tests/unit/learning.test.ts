import { describe, expect, it } from "vitest";
import { decideFact, groundedInUserText, normalizeSubjectKey, parseCandidateFacts, planWrite, type CandidateFact } from "@/modules/memory/learning";
import { needsSearch } from "@/modules/memory/server/gateway";

const fact = (o: Partial<CandidateFact>): CandidateFact => ({
  kind: "fact",
  key: "budget",
  title: "Budget",
  content: "Le budget est de 15 000 €.",
  statedBy: "user",
  about: "client",
  confidence: 0.9,
  attributes: {},
  effectiveDate: null,
  ...o,
});

describe("learning rules (Cendr Consciousness)", () => {
  it("normalises subject keys", () => {
    expect(normalizeSubjectKey("Contact: Jean Dupont")).toBe("contact:jean_dupont");
    expect(normalizeSubjectKey("Date de lancement !")).toBe("date_de_lancement");
    expect(normalizeSubjectKey("   ")).toBeNull();
  });

  it("reads the model's answer strictly; malformed items are dropped, one fact per key", () => {
    const facts = parseCandidateFacts(
      'Voici : [{"kind":"decision","key":"Hosting","title":"Hébergement","content":"UE.","stated_by":"user","about":"client","confidence":2,"attributes":{"amount":"15 000,50","date":"bad"}},{"title":""},{"key":"hosting","title":"Hébergement","content":"Europe.","stated_by":"user","about":"client"}]',
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ key: "hosting", content: "Europe.", confidence: 0.5, statedBy: "user" });
    expect(parseCandidateFacts("not json")).toEqual([]);
    const [withAttributes] = parseCandidateFacts('[{"key":"budget","title":"B","content":"C","confidence":2,"attributes":{"amount":"15 000,50","date":"bad","due":"2027-01-31"}}]');
    expect(withAttributes.confidence).toBe(1);
    expect(withAttributes.attributes).toEqual({ amount: 15000.5, due: "2027-01-31" });
  });

  it("a fact said by the person must be grounded in their message", () => {
    expect(groundedInUserText(fact({}), "Budget validé : 15 000 € pour Atlas")).toBe(true);
    expect(groundedInUserText(fact({ content: "Le budget est de 50 000 €." }), "Budget validé : 15 000 €")).toBe(false);
    expect(groundedInUserText(fact({ content: "Contact : Jean Dupont.", attributes: { person: "Jean Dupont" } }), "parle à Marie Curie")).toBe(false);
  });

  it("decides: learned, to confirm, private or dropped", () => {
    expect(decideFact(fact({}), "budget 15 000 €")).toBe("learn");
    expect(decideFact(fact({ statedBy: "assistant" }), "budget 15 000 €")).toBe("confirm");
    expect(decideFact(fact({ confidence: 0.4 }), "budget 15 000 €")).toBe("confirm");
    expect(decideFact(fact({ about: "person" }), "budget 15 000 €")).toBe("private");
    expect(decideFact(fact({ about: "other" }), "budget 15 000 €")).toBe("drop");
  });

  it("a new value supersedes; the same fact only confirms; a different subject is added", () => {
    const known = [{ id: "old", key: "budget", title: "Budget", content: "Le budget validé est de 15 000 €.", attributes: { amount: 15000 } }];
    expect(planWrite(fact({ content: "Le budget est de 18 000 €.", attributes: { amount: 18000 } }), known)).toEqual({ action: "supersede", existingId: "old" });
    expect(planWrite(fact({ content: "Le budget est de 18 000 €." }), known)).toEqual({ action: "supersede", existingId: "old" });
    expect(planWrite(fact({ content: "Budget validé : 15 000 €.", attributes: { amount: 15000 } }), known)).toEqual({ action: "confirm", existingId: "old" });
    expect(planWrite(fact({ key: "launch_date", content: "Lancement le 12 mars." }), known)).toEqual({ action: "insert" });
  });

  it("skips the search for greetings and thanks", () => {
    expect(needsSearch("merci beaucoup")).toBe(false);
    expect(needsSearch("Quel est le budget ?")).toBe(true);
  });
});
