import { describe, expect, it } from "vitest";
import { decideFact, groundedInUserText, LEARN_FACTS_SYSTEM, normalizeSubjectKey, parseCandidateFacts, planWrite, type CandidateFact } from "@/modules/memory/learning";
import { needsSearch } from "@/modules/memory/server/gateway";
import { buildSystemPrompt } from "@/modules/conversations/system-prompt";
import type { KnowledgePassage } from "@/modules/memory/types";

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

  it("only the person writing is private: a client's contact person is about the client (found with a real model)", () => {
    expect(LEARN_FACTS_SYSTEM).toContain('"about": "client|writer|other"');
    expect(LEARN_FACTS_SYSTEM).toContain('a contact person at the client is "client"');
    const about = (value: string) => parseCandidateFacts(`[{"kind":"contact","key":"k","title":"T","content":"C","about":"${value}"}]`)[0].about;
    expect(about("client")).toBe("client");
    expect(about("writer")).toBe("person");
    expect(about("person")).toBe("person"); // older wording: still kept private
    expect(about("other")).toBe("other");
  });

  it("a key built from a Hide placeholder gets the real value back (found with a real model)", () => {
    const names = new Map([["[PERSON_1]", "Jean Dupont"]]);
    const restore = (t: string) => t.replace(/\[[A-Z]+_\d+\]/g, (p) => names.get(p) ?? p);
    const parse = (key: string) => parseCandidateFacts(`[{"kind":"contact","key":"${key}","title":"Contact","content":"[PERSON_1], directeur marketing.","about":"client"}]`, restore)[0];
    expect(parse("contact:person_1").key).toBe("contact:jean_dupont");
    expect(parse("contact_PERSON_1").key).toBe("contact_jean_dupont");
    expect(parse("contact:person_1").content).toBe("Jean Dupont, directeur marketing.");
    // Unknown to this conversation: left as it is (never guessed).
    expect(parse("contact:person_2").key).toBe("contact:person_2");
  });

  it("a new value may name the value it replaces without being taken as made up (found with a real model)", () => {
    const update = fact({ content: "Le budget d'Atlas passe à 18 000 €, en remplacement des 15 000 € précédemment indiqués.", attributes: { amount: 18000 } });
    const known = [{ id: "k", key: "budget", title: "Budget", content: "Le budget d'Atlas est de 15 000 €.", attributes: { amount: 15000 } }];
    expect(decideFact(update, "Mise à jour : le budget d'Atlas passe à 18 000 €.", known)).toBe("learn");
    expect(decideFact(update, "Mise à jour : le budget d'Atlas passe à 18 000 €.")).toBe("confirm");
    // Another subject's figure is still not allowed in.
    expect(decideFact(fact({ key: "launch_budget", content: "15 000 € pour le lancement." }), "budget 18 000 €", known)).toBe("confirm");
  });

  it("a key fact that replaced an older value says so to the model (not a mistake, a change)", () => {
    const passage: KnowledgePassage = {
      position: 1, sourceType: "memory_entry", id: "e", documentId: null, spaceId: "s", spaceKind: "client", clientName: "Atlas",
      title: "Budget", content: "Le budget d'Atlas passe à 18 000 €.", page: null, charStart: null, charEnd: null,
      sourceDate: "2026-11-07", reason: "brief", kind: "fact", replaced: { content: "Le budget d'Atlas est de 15 000 €.", on: "2026-11-07" },
    };
    const prompt = buildSystemPrompt({ company: { name: "Co" }, user: { name: "Bruno" }, locale: "fr", today: "2026-11-07", knowledge: [passage] });
    expect(prompt).toContain("This replaced on 2026-11-07 an earlier value, no longer true");
    expect(prompt).toContain("15 000 €");
    expect(prompt).toContain("it was not a mistake");
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
