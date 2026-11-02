import { describe, expect, it } from "vitest";
import { naturalMention, parseMention } from "@/modules/collaboration/mentions";

describe("natural mentions in group conversations", () => {
  it("turns an assistant clearly addressed at the start into a mention", () => {
    expect(naturalMention("hello chat tu peux me faire ça")).toBe("hello @ChatGPT tu peux me faire ça");
    expect(naturalMention("Claude, peux-tu résumer ?")).toBe("@Claude, peux-tu résumer ?");
    expect(naturalMention("Salut Gemini peux-tu traduire ce texte")).toBe("Salut @Gemini peux-tu traduire ce texte");
    expect(naturalMention("IA : un plan en 3 points")).toBe("@IA : un plan en 3 points");
    expect(naturalMention("ok chatgpt fais un tableau")).toBe("ok @ChatGPT fais un tableau");
    expect(parseMention(naturalMention("hello chat tu peux me faire ça"))).toBe("openai");
  });

  it("leaves everything else alone", () => {
    expect(naturalMention("le chat de Pierre est malade")).toBe("le chat de Pierre est malade");
    expect(naturalMention("chat de Pierre")).toBe("chat de Pierre");
    expect(naturalMention("IA générative, c'est quoi ?")).toBe("IA générative, c'est quoi ?");
    expect(naturalMention("Nathalie, tu as vu Claude hier ?")).toBe("Nathalie, tu as vu Claude hier ?");
    expect(naturalMention("@Claude et Gemini, à vous")).toBe("@Claude et Gemini, à vous");
  });
});
