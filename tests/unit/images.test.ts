import { describe, expect, it } from "vitest";
import { imageIntent } from "@/modules/images/intent";

describe("image requests in the chat", () => {
  it("recognises a request for a new image, in French and English", () => {
    expect(imageIntent("Crée une image d'un chat astronaute", { hasImage: false })).toBe("generate");
    expect(imageIntent("Génère-moi un logo minimaliste pour une boulangerie", { hasImage: false })).toBe("generate");
    expect(imageIntent("Dessine une maison au bord de la mer", { hasImage: false })).toBe("generate");
    expect(imageIntent("Can you create a picture of a red bicycle?", { hasImage: false })).toBe("generate");
  });

  it("changes a photo when one is there", () => {
    expect(imageIntent("Ajoute un alien à la photo", { hasImage: true })).toBe("edit");
    expect(imageIntent("make it blue", { hasImage: true })).toBe("edit");
    expect(imageIntent("Ajoute un alien à la photo", { hasImage: false })).toBeNull();
  });

  it("leaves questions and ordinary messages alone", () => {
    expect(imageIntent("Comment créer une image dans Canva ?", { hasImage: false })).toBeNull();
    expect(imageIntent("Résume ce document en trois points", { hasImage: false })).toBeNull();
    expect(imageIntent("Peux-tu décrire cette photo ?", { hasImage: true })).toBeNull();
  });

  it("the Image button forces it", () => {
    expect(imageIntent("un coucher de soleil sur Paris", { hasImage: false, forced: true })).toBe("generate");
  });
});
