import { describe, expect, it } from "vitest";
import type { CatalogModel } from "@/modules/providers/catalog";
import { confrontModels, critiquePrompt, estimateConfrontation, estimateSingleAnswer, parseSynthesis, pickJudge } from "@/modules/confronter/prompts";

const pricing = { inputUsdPerMtok: 1, outputUsdPerMtok: 4, cachedInputUsdPerMtok: 0.1, inputCreditsPerMtok: 1000, outputCreditsPerMtok: 4000, cachedInputCreditsPerMtok: 100 };
const model = (id: string, provider: CatalogModel["provider"], tier: CatalogModel["tier"]) => ({ id, provider, tier, label: id, apiModelId: id, pricing }) as CatalogModel;

describe("Confronter: who takes part", () => {
  const allowed = [model("gpt-fast", "openai", "fast"), model("gpt-mid", "openai", "balanced"), model("claude-mid", "anthropic", "balanced"), model("gemini-top", "google", "advanced")];

  it("takes one model per allowed and configured provider, balanced first", () => {
    expect(confrontModels(allowed, new Set(["openai", "anthropic", "google"])).map((m) => m.id)).toEqual(["gpt-mid", "claude-mid", "gemini-top"]);
    expect(confrontModels(allowed, new Set(["openai"])).map((m) => m.id)).toEqual(["gpt-mid"]);
  });

  it("lets the company default's provider write the synthesis", () => {
    const models = confrontModels(allowed, new Set(["openai", "anthropic", "google"]));
    expect(pickJudge(models, allowed.find((m) => m.id === "claude-mid")).id).toBe("claude-mid");
    expect(pickJudge(models, allowed.find((m) => m.id === "gpt-fast")).id).toBe("gpt-mid");
    expect(pickJudge(models, undefined).id).toBe("gpt-mid");
  });
});

describe("Confronter: credit estimate shown before running", () => {
  it("costs several times a normal question and grows with the history", () => {
    const models = [model("a", "openai", "balanced"), model("b", "anthropic", "balanced"), model("c", "google", "balanced")];
    const small = estimateConfrontation(models, models[0], 500);
    const single = estimateSingleAnswer(models[0], 500);
    expect(small / single).toBeGreaterThan(5);
    expect(estimateConfrontation(models, models[0], 20_000)).toBeGreaterThan(small);
  });
});

describe("Confronter: prompts and synthesis", () => {
  it("gives each critic the other answers, named", () => {
    const prompt = critiquePrompt("Quel budget ?", [{ model: { id: "b", provider: "anthropic", label: "Sonnet 5.5" }, content: "20 000 €" }]);
    expect(prompt).toContain("Question:\nQuel budget ?");
    expect(prompt).toContain("Answer from Claude (Sonnet 5.5):\n20 000 €");
  });

  it("reads the judge's JSON, and falls back to the text as the recommended answer", () => {
    const parsed = parseSynthesis('```json\n{"agreements":["A"],"divergences":[],"errors":["E"],"to_verify":["V"],"recommended":"Réponse [S1]"}\n```');
    expect(parsed).toEqual({ agreements: ["A"], divergences: [], errors: ["E"], toVerify: ["V"], recommended: "Réponse [S1]" });
    expect(parseSynthesis("Juste un texte.")).toEqual({ agreements: [], divergences: [], errors: [], toVerify: [], recommended: "Juste un texte." });
  });
});
