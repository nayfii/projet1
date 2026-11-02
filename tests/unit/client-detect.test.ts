import { describe, expect, it } from "vitest";
import { detectClientMention } from "@/modules/clients/detect";

const clients = [
  { id: "1", name: "Nike" },
  { id: "2", name: "Nike France" },
  { id: "3", name: "Boulangerie Martin" },
];

describe("finding the client a message talks about", () => {
  it("links a known client named in the text, whole words only, accents and case ignored", () => {
    expect(detectClientMention("Prépare un plan de réunion pour nike demain", clients)).toEqual({ kind: "link", id: "1", name: "Nike" });
    expect(detectClientMention("Le dossier Nike France avance", clients)).toEqual({ kind: "link", id: "2", name: "Nike France" });
    expect(detectClientMention("Relance la boulangerie martin", clients)).toEqual({ kind: "link", id: "3", name: "Boulangerie Martin" });
    expect(detectClientMention("Les Nikes de mon fils", clients)).toBeNull();
  });

  it("suggests creating a client introduced as one", () => {
    expect(detectClientMention("Prépare une proposition pour le client Atlas Conseil.", clients)).toEqual({ kind: "create", name: "Atlas Conseil" });
    expect(detectClientMention("Draft an email to our customer Globex", clients)).toEqual({ kind: "create", name: "Globex" });
    expect(detectClientMention("un client mécontent a appelé", clients)).toBeNull();
    expect(detectClientMention("ok", clients)).toBeNull();
  });
});
