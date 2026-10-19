import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { CatalogModel } from "@/modules/providers/catalog";
import { modelDisplay } from "@/modules/providers/catalog";
import { classifyTask, routeRequest } from "@/modules/providers/router";
import { normalizeProviderError } from "@/modules/providers/errors";
import { buildChatContext, contextBudget, CHAT_CONTEXT_CAP } from "@/modules/conversations/context";
import { buildSystemPrompt, CLARIFICATION_RULES } from "@/modules/conversations/system-prompt";
import { splitNdjson } from "@/modules/conversations/ndjson";
import { computeCharge } from "@/modules/usage/credits";
import { evaluateQuota } from "@/modules/usage/quota";
import { contentMatchesExtension, decodeText, extractText } from "@/modules/documents/server/extract";
import { createFakeProvider } from "@/modules/providers/server/adapters/fake";
import type { ChatEvent, ChatRequest } from "@/modules/providers/types";

function model(id: string, provider: CatalogModel["provider"], tier: CatalogModel["tier"], strengths: string[], extra: Partial<CatalogModel> = {}): CatalogModel {
  const rates = { fast: [100, 500], balanced: [2000, 10000], advanced: [10000, 50000] }[tier];
  return {
    id,
    provider,
    apiModelId: id,
    label: id,
    tier,
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsImages: true,
    strengths,
    sortOrder: 0,
    pricing: { inputUsdPerMtok: 1, outputUsdPerMtok: 1, cachedInputUsdPerMtok: 0, inputCreditsPerMtok: rates[0], outputCreditsPerMtok: rates[1], cachedInputCreditsPerMtok: 0 },
    ...extra,
  };
}

// Mirrors the default catalogue (supabase/migrations/20261019000001_chat_usage.sql).
const CATALOGUE = [
  model("gpt-6-luna", "openai", "fast", ["speed"], { sortOrder: 10, contextWindow: 400_000 }),
  model("gpt-6.1-sol", "openai", "balanced", ["reasoning", "code"], { sortOrder: 11, contextWindow: 400_000 }),
  model("gpt-6-astra", "openai", "advanced", ["reasoning", "code", "long_context"], { sortOrder: 12, contextWindow: 400_000 }),
  model("claude-haiku-5-5", "anthropic", "fast", ["speed", "writing"], { sortOrder: 20 }),
  model("claude-sonnet-5-5", "anthropic", "balanced", ["writing", "code", "reasoning"], { sortOrder: 21 }),
  model("claude-opus-5-5", "anthropic", "advanced", ["reasoning", "writing", "code"], { sortOrder: 22 }),
  model("gemini-flash-lite", "google", "fast", ["speed", "long_context"], { sortOrder: 30, contextWindow: 1_000_000 }),
  model("gemini-flash", "google", "balanced", ["long_context", "vision", "speed"], { sortOrder: 31, contextWindow: 1_000_000 }),
  model("gemini-pro", "google", "advanced", ["reasoning", "long_context", "code"], { sortOrder: 32, contextWindow: 1_000_000 }),
];

const input = (text: string, extra: Partial<Parameters<typeof classifyTask>[0]> = {}) => ({
  text,
  imageCount: 0,
  attachmentChars: 0,
  historyTokens: 0,
  ...extra,
});

describe("Smart Router (Auto mode)", () => {
  it.each([
    ["Quelle est la capitale du Portugal ?", "quick"],
    ["What time zone is Lisbon in?", "quick"],
    ["Rédige un e-mail de relance pour le devis envoyé à Dupont la semaine dernière", "writing"],
    ["Write a short LinkedIn post announcing our new office", "writing"],
    ["Analyse les risques de ce projet et compare les deux options", "analysis"],
    ["Why did our margin drop last quarter? Give me the main hypotheses", "analysis"],
    ["Rédige un e-mail sur la marge du projet", "writing"],
    ["Écris une formule Excel =SOMME( pour totaliser la colonne B", "code"],
    ["Peux-tu corriger ce script Python qui plante ?", "code"],
  ])("classifies %j as %s", (text, task) => {
    expect(classifyTask(input(text))).toBe(task);
  });

  it("does not mistake a postcode for code", () => {
    expect(classifyTask(input("Quel est le code postal de Lyon 3e ?"))).toBe("quick");
  });

  it("treats images and long content separately", () => {
    expect(classifyTask(input("Que vois-tu ?", { imageCount: 1 }))).toBe("vision");
    expect(classifyTask(input("Résume", { attachmentChars: 200_000 }))).toBe("long_context");
  });

  it("sends writing to Claude, quick questions to a fast model, long documents to Gemini", () => {
    expect(routeRequest(input("Rédige une proposition commerciale pour un nouveau client"), CATALOGUE)).toEqual({
      modelId: "claude-sonnet-5-5",
      task: "writing",
      basis: "quality",
    });
    expect(routeRequest(input("Combien font 12 % de 340 ?"), CATALOGUE)?.basis).toBe("speed");
    expect(CATALOGUE.find((m) => m.id === routeRequest(input("Combien font 12 % de 340 ?"), CATALOGUE)?.modelId)?.tier).toBe("fast");
    expect(routeRequest(input("Résume ce rapport", { attachmentChars: 300_000 }), CATALOGUE)?.modelId).toMatch(/^gemini/);
  });

  it("only picks among the models it is given (allowed + configured)", () => {
    const onlyOpenAI = CATALOGUE.filter((m) => m.provider === "openai");
    expect(routeRequest(input("Rédige un e-mail"), onlyOpenAI)?.modelId).toBe("gpt-6.1-sol");
    expect(routeRequest(input("Bonjour"), [])).toBeNull();
  });

  it("never picks a model whose context window is too small", () => {
    const small = [model("tiny", "openai", "balanced", ["writing"], { contextWindow: 20_000, maxOutputTokens: 4_000 })];
    expect(routeRequest(input("Résume", { attachmentChars: 200_000 }), small)).toBeNull();
  });

  it("is deterministic", () => {
    const a = routeRequest(input("Analyse ce budget et propose un plan d'action"), CATALOGUE);
    const b = routeRequest(input("Analyse ce budget et propose un plan d'action"), CATALOGUE);
    expect(a).toEqual(b);
  });
});

describe("AI Clarification and system prompt", () => {
  const base = { company: { name: "Atelier Martin" }, user: { name: "Olivier" }, locale: "fr" as const, today: "2026-10-19" };

  it("contains the ask-one-short-question rule, and when not to ask", () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain(CLARIFICATION_RULES);
    expect(prompt).toMatch(/ask ONE short question/);
    expect(prompt).toMatch(/Never ask more than one question/);
    expect(prompt).toMatch(/reasonable assumption/);
  });

  it("asks the model to say it does not know rather than invent internal facts", () => {
    expect(buildSystemPrompt(base)).toMatch(/say that you don't know/);
  });

  it("answers in the user's language, with the user's locale as fallback", () => {
    expect(buildSystemPrompt(base)).toMatch(/answer in French/);
    expect(buildSystemPrompt({ ...base, locale: "en" })).toMatch(/answer in English/);
  });

  it("includes the linked client only when there is one", () => {
    expect(buildSystemPrompt(base)).not.toMatch(/client:/);
    expect(buildSystemPrompt({ ...base, client: { name: "Client A", sector: "Retail" } })).toMatch(/about the client: Client A/);
  });
});

describe("single context builder (model-independent knowledge)", () => {
  const system = "SYSTEM";
  const history = [
    { role: "user" as const, text: "Bonjour" },
    { role: "assistant" as const, text: "Bonjour ! Comment puis-je aider ?" },
    { role: "user" as const, text: "Résume ce document", attachments: [{ filename: "notes.txt", kind: "document" as const, text: "Budget 2027 : 12 000 €" }] },
  ];

  it("gives every model exactly the same context: switching model loses nothing", async () => {
    const budget = contextBudget(CATALOGUE);
    const context = buildChatContext({ system, history, budgetTokens: budget });
    // The same platform-built request goes to whichever provider is chosen; only the wire format differs.
    const received: ChatRequest[] = [];
    for (const provider of ["openai", "anthropic", "google"] as const) {
      const request: ChatRequest = { apiModelId: provider, system: context.system, messages: context.messages, maxOutputTokens: 1000 };
      const stream = createFakeProvider(provider).stream(request, new AbortController().signal)[Symbol.asyncIterator]();
      while (!(await stream.next()).done) {
        // drain
      }
      received.push(request);
    }
    expect(received[0].system).toBe(received[1].system);
    expect(received[1].messages).toEqual(received[2].messages);
    expect(context.messages).toHaveLength(3);
    expect(context.messages[2].content[0]).toMatchObject({ type: "text" });
    expect((context.messages[2].content[0] as { text: string }).text).toContain('<attachment name="notes.txt">');
  });

  it("uses the smallest usable window of the company's models, capped for cost", () => {
    expect(contextBudget(CATALOGUE)).toBe(CHAT_CONTEXT_CAP);
    expect(contextBudget([model("a", "openai", "fast", [], { contextWindow: 32_000, maxOutputTokens: 8_000 }), ...CATALOGUE])).toBe(24_000);
  });

  it("drops the oldest messages first when the conversation is too long, and says so", () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `message ${i} ` + "x".repeat(700) }));
    long.push({ role: "user", text: "dernière question" });
    const context = buildChatContext({ system, history: long, budgetTokens: 3_000 });
    expect(context.omittedMessages).toBeGreaterThan(0);
    expect(context.messages[0].role).toBe("user");
    expect(context.system).toMatch(/oldest message\(s\).*left out/);
    const last = context.messages.at(-1)!;
    expect((last.content[0] as { text: string }).text).toBe("dernière question");
    expect(context.estimatedTokens).toBeLessThanOrEqual(3_000);
  });

  it("merges consecutive turns of the same role (after a failed answer)", () => {
    const context = buildChatContext({
      system,
      history: [
        { role: "user", text: "première" },
        { role: "user", text: "deuxième" },
      ],
      budgetTokens: 10_000,
    });
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0].content.map((p) => (p.type === "text" ? p.text : "")).join("")).toContain("première\n\ndeuxième");
  });

  it("shortens a huge attachment instead of failing", () => {
    const context = buildChatContext({
      system,
      history: [{ role: "user", text: "Résume", attachments: [{ filename: "big.txt", kind: "document", text: "y".repeat(200_000) }] }],
      budgetTokens: 5_000,
    });
    const text = (context.messages[0].content[0] as { text: string }).text;
    expect(text.length).toBeLessThan(20_000);
    expect(text).toContain("Only the first part of this document is included");
  });

  it("re-sends recent images as images and describes older ones in words", () => {
    const image = { data: new Uint8Array([1, 2, 3]), mediaType: "image/png" };
    const context = buildChatContext({
      system,
      history: [
        { role: "user", text: "old", attachments: [{ filename: "old.png", kind: "image", image: null }] },
        { role: "assistant", text: "ok" },
        { role: "user", text: "new", attachments: [{ filename: "new.png", kind: "image", image }] },
      ],
      budgetTokens: 20_000,
    });
    expect(context.messages[0].content.some((p) => p.type === "image")).toBe(false);
    expect((context.messages[0].content[0] as { text: string }).text).toContain("not shown again");
    expect(context.messages[2].content.some((p) => p.type === "image")).toBe(true);
  });
});

describe("credits and quotas", () => {
  const pricing = CATALOGUE.find((m) => m.id === "claude-sonnet-5-5")!.pricing;

  it("computes credits from the provider's token counts and the catalogue rates", () => {
    // 1,000 input + 500 output tokens at 2,000 / 10,000 credits per million.
    expect(computeCharge(pricing, { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0 }).credits).toBe(7);
  });

  it("charges cached input at the cached rate", () => {
    const withCache = computeCharge({ ...pricing, cachedInputCreditsPerMtok: 200 }, { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 800 });
    expect(withCache.credits).toBeCloseTo(0.2 * 2 + 0.8 * 0.2, 4);
  });

  it("computes an estimated cost in dollars", () => {
    expect(computeCharge({ ...pricing, inputUsdPerMtok: 2, outputUsdPerMtok: 10 }, { inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 0 }).estimatedCostUsd).toBe(3);
  });

  const status = (companyUsed: number, userUsed = 0, userLimit: number | null = null) => ({
    periodStart: "2026-10-01",
    companyLimit: 1000,
    companyUsed,
    userLimit,
    userUsed,
  });

  it("warns from 80 % and stops at 100 %", () => {
    expect(evaluateQuota(status(799)).state).toBe("ok");
    expect(evaluateQuota(status(800))).toMatchObject({ state: "warning", scope: "company" });
    expect(evaluateQuota(status(1000))).toMatchObject({ state: "blocked", scope: "company" });
  });

  it("applies the personal limit when it is the tighter one", () => {
    expect(evaluateQuota(status(100, 85, 100))).toMatchObject({ state: "warning", scope: "user" });
    expect(evaluateQuota(status(100, 100, 100))).toMatchObject({ state: "blocked", scope: "user" });
    expect(evaluateQuota(status(100, 0, 0))).toMatchObject({ state: "blocked", scope: "user" });
  });

  it("blocks a company without credits (no plan)", () => {
    expect(evaluateQuota({ ...status(0), companyLimit: 0 }).state).toBe("blocked");
  });
});

describe("provider errors are explained, never leaked", () => {
  it.each([
    [{ name: "AI_LoadAPIKeyError" }, "missing_key"],
    [{ statusCode: 401 }, "auth_failed"],
    [{ statusCode: 429, responseBody: '{"error":{"type":"rate_limit_error"}}' }, "rate_limited"],
    [{ statusCode: 429, responseBody: '{"error":{"type":"insufficient_quota"}}' }, "provider_quota"],
    [{ statusCode: 503 }, "unavailable"],
    [{ statusCode: 529 }, "unavailable"],
    [{ statusCode: 404 }, "model_not_found"],
    [{ statusCode: 400, responseBody: "prompt is too long: 250000 tokens > 200000 maximum" }, "context_too_long"],
    [{ statusCode: 400, responseBody: "blocked by safety settings" }, "content_filtered"],
    [{ message: "fetch failed", cause: { code: "ECONNREFUSED" } }, "unavailable"],
    [new Error("weird"), "unknown"],
  ])("maps %j to %s", (error, code) => {
    expect(normalizeProviderError(error).code).toBe(code);
  });

  it("keeps only the code and status, never the request body", () => {
    const result = normalizeProviderError({ statusCode: 500, requestBodyValues: { messages: ["secret prompt"] }, responseBody: "secret" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("clear model labels", () => {
  it("splits brand and model name", () => {
    expect(modelDisplay("anthropic", "Claude Sonnet 5.5")).toEqual({ brand: "Claude", name: "Sonnet 5.5" });
    expect(modelDisplay("openai", "GPT-6.1 Sol")).toEqual({ brand: "ChatGPT", name: "GPT-6.1 Sol" });
    expect(modelDisplay("google", "Gemini Flash")).toEqual({ brand: "Gemini", name: "Flash" });
  });
});

describe("streaming wire format", () => {
  it("splits NDJSON chunks into complete lines", () => {
    expect(splitNdjson('{"a":1}\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
    expect(splitNdjson("")).toEqual({ lines: [], rest: "" });
  });

  it("test provider answers are visibly labelled and report usage", async () => {
    const events: ChatEvent[] = [];
    for await (const e of createFakeProvider("openai").stream(
      { apiModelId: "x", system: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], maxOutputTokens: 100 },
      new AbortController().signal,
    )) {
      events.push(e);
    }
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toMatch(/^\[TEST\]/);
    expect(events.some((e) => e.type === "usage")).toBe(true);
  });
});

describe("attachments are read on our server", () => {
  it("decodes UTF-8 and older Windows-1252 text files", () => {
    expect(decodeText(new TextEncoder().encode("Réunion à 10 h"))).toBe("Réunion à 10 h");
    expect(decodeText(new Uint8Array([0x52, 0xe9, 0x75, 0x6e, 0x69, 0x6f, 0x6e]))).toBe("Réunion");
  });

  it("refuses a file whose content does not match its extension", () => {
    expect(contentMatchesExtension(new TextEncoder().encode("%PDF-1.7"), "pdf")).toBe(true);
    expect(contentMatchesExtension(new TextEncoder().encode("not a pdf"), "pdf")).toBe(false);
    expect(contentMatchesExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "png")).toBe(true);
    expect(contentMatchesExtension(new Uint8Array([0, 1, 2]), "txt")).toBe(false);
  });

  it("extracts spreadsheet cells as text", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Ventes");
    sheet.addRow(["Produit", "Montant"]);
    sheet.addRow(["Conseil", 1200]);
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const { text, truncated } = await extractText(buffer, "xlsx");
    expect(truncated).toBe(false);
    expect(text).toContain("## Ventes");
    expect(text).toContain("Conseil | 1200");
  });

  it("extracts the text of a PDF", async () => {
    const pdf = minimalPdf("Bonjour Atelier Martin");
    const { text } = await extractText(pdf, "pdf");
    expect(text).toContain("Bonjour Atelier Martin");
  });

  it("cuts very long documents and says so", async () => {
    const { text, truncated } = await extractText(new TextEncoder().encode("a".repeat(50_000)), "txt");
    expect(truncated).toBe(true);
    expect(text.length).toBe(40_000);
  });
});

/** Smallest valid one-page PDF with one line of text (built by hand, offsets computed). */
function minimalPdf(line: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 20 100 Td (${line}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
