import { describe, expect, it } from "vitest";
import type { CatalogModel } from "@/modules/providers/catalog";
import { modelForProvider, parseMention, suggestedColleagues } from "@/modules/collaboration/mentions";
import { filterMentions, mentionAt, type MentionOption } from "@/modules/collaboration/ui/mention-menu";

const model = (id: string, provider: CatalogModel["provider"], tier: CatalogModel["tier"]) => ({ id, provider, tier }) as CatalogModel;

describe("mentions: the AI answers only when called", () => {
  it.each([
    ["@Claude, résume ce fil", "anthropic"],
    ["Peux-tu vérifier @chatgpt ?", "openai"],
    ["(@GPT) une idée ?", "openai"],
    ["@Gemini traduis", "google"],
    ["@IA propose un plan", "selected"],
    ["What do you think @AI", "selected"],
    ["« @ia » réponds", "selected"],
  ])("%s → %s", (text, expected) => {
    expect(parseMention(text)).toBe(expected);
  });

  it.each(["Bonjour Nathalie", "écris à nathalie@exemple.fr", "@Claudette arrive demain", "le mot IA sans arobase", "@iaa"])("ignores %s", (text) => {
    expect(parseMention(text)).toBeNull();
  });

  it("answers @Claude with an allowed, configured model of that provider, balanced first", () => {
    const allowed = [model("claude-haiku", "anthropic", "fast"), model("claude-sonnet", "anthropic", "balanced"), model("gpt", "openai", "balanced")];
    expect(modelForProvider("anthropic", allowed, new Set(["anthropic", "openai"]))?.id).toBe("claude-sonnet");
    expect(modelForProvider("anthropic", allowed.slice(0, 1), new Set(["anthropic"]))?.id).toBe("claude-haiku");
    expect(modelForProvider("anthropic", allowed, new Set(["openai"]))).toBeNull();
    expect(modelForProvider("google", allowed, new Set(["google"]))).toBeNull();
  });
});

describe("mention menu", () => {
  const options: MentionOption[] = [
    { token: "IA", aliases: ["ai", "ia"], provider: null, hint: "" },
    { token: "ChatGPT", aliases: ["gpt"], provider: "openai", hint: "" },
    { token: "Claude", aliases: [], provider: "anthropic", hint: "" },
  ];

  it("finds the @… being typed before the caret", () => {
    expect(mentionAt("Salut @Cl", 9)).toEqual({ start: 6, query: "Cl" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("mail@exemple", 12)).toBeNull();
    expect(mentionAt("@Claude fini ", 13)).toBeNull();
  });

  it("filters by name and alias", () => {
    expect(filterMentions(options, "").map((o) => o.token)).toEqual(["IA", "ChatGPT", "Claude"]);
    expect(filterMentions(options, "c").map((o) => o.token)).toEqual(["ChatGPT", "Claude"]);
    expect(filterMentions(options, "gp").map((o) => o.token)).toEqual(["ChatGPT"]);
    expect(filterMentions(options, "a").map((o) => o.token)).toEqual(["IA"]);
  });
});

describe("Who Can Help: colleagues the answer names", () => {
  const colleagues = [
    { userId: "1", name: "Nathalie Durand" },
    { userId: "2", name: "Paul Martin" },
    { userId: "3", name: "Paul Bernard" },
    { userId: "4", name: "Al Smith" },
  ];

  it("recognises a full name or a first name only one colleague has", () => {
    expect(suggestedColleagues("Nathalie a travaillé sur ce sujet, demandez-lui.", colleagues).map((c) => c.userId)).toEqual(["1"]);
    expect(suggestedColleagues("Voyez avec Paul Bernard.", colleagues).map((c) => c.userId)).toEqual(["3"]);
  });

  it("ignores ambiguous or too short first names and partial words", () => {
    expect(suggestedColleagues("Demandez à Paul.", colleagues)).toEqual([]);
    expect(suggestedColleagues("Al pourrait aider.", colleagues)).toEqual([]);
    expect(suggestedColleagues("Les Nathaliennes", colleagues)).toEqual([]);
  });
});
