import { describe, expect, it } from "vitest";
import { chunkText } from "@/modules/memory/chunking";
import { keywordQuery } from "@/modules/memory/keywords";
import { citedPositions, linkCitations } from "@/modules/memory/citations";
import { parseModelJson } from "@/modules/memory/json";
import { fakeEmbedding } from "@/modules/providers/fake-embedding";
import { buildSystemPrompt, KNOWLEDGE_RULES } from "@/modules/conversations/system-prompt";
import { buildChatContext } from "@/modules/conversations/context";
import { conversationScope, type MemorySpace } from "@/modules/memory/server/retrieval";
import { extractDocument } from "@/modules/documents/server/extract";
import type { KnowledgePassage } from "@/modules/memory/types";
import { minimalPdf } from "../helpers/pdf";

describe("document passages (chunking)", () => {
  const paragraph = (i: number) => `Paragraphe ${i}. ` + "Le client souhaite un suivi hebdomadaire et des comptes rendus courts. ".repeat(6);
  const text = Array.from({ length: 8 }, (_, i) => paragraph(i)).join("\n\n");

  it("keeps the exact position of every passage in the document text", () => {
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(text.slice(c.charStart, c.charEnd).trim()).toBe(c.content);
      expect(c.content.length).toBeLessThanOrEqual(1100);
    }
  });

  it("covers the whole text, with a small overlap between passages", () => {
    const chunks = chunkText(text);
    expect(chunks[0].charStart).toBe(0);
    expect(chunks.at(-1)!.charEnd).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeLessThan(chunks[i - 1].charEnd);
      expect(chunks[i].charStart).toBeGreaterThan(chunks[i - 1].charStart);
    }
  });

  it("prefers paragraph breaks and records the PDF page of each passage", () => {
    const pages = [
      { page: 1, start: 0, end: 2000 },
      { page: 2, start: 2002, end: text.length },
    ];
    const chunks = chunkText(text, pages);
    expect(chunks[0].page).toBe(1);
    expect(chunks.at(-1)!.page).toBe(2);
    expect(chunks.slice(0, -1).some((c) => /\.\s*$/.test(c.content))).toBe(true);
  });

  it("handles short and empty texts", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("  Bonjour  ")).toEqual([{ index: 0, content: "Bonjour", page: null, charStart: 2, charEnd: 11 }]);
  });
});

describe("exact-word search terms", () => {
  it("keeps names, numbers and rare words; drops filler words (FR and EN)", () => {
    expect(keywordQuery("Quel est le délai de paiement du Client Dupont pour 2027 ?")).toBe("delai or paiement or client or dupont or 2027");
    expect(keywordQuery("What is the payment term for the Acme contract?")).toBe("payment or term or acme or contract");
  });

  it("returns nothing when there is nothing significant", () => {
    expect(keywordQuery("et le la ?")).toBe("");
  });
});

describe("citations", () => {
  it("finds cited passages in order, ignoring unknown numbers", () => {
    expect(citedPositions("Selon [S2], puis [S1][S2] et [S9].", 3)).toEqual([2, 1]);
    expect(citedPositions("Aucune source.", 3)).toEqual([]);
  });

  it("turns citations into links the answer renderer shows as badges", () => {
    expect(linkCitations("Voir [S1] et [S12].")).toBe("Voir [S1](#source-1) et [S12](#source-12).");
    expect(linkCitations("Déjà [S1](#source-1)")).toBe("Déjà [S1](#source-1)");
  });
});

describe("reading JSON from a model answer", () => {
  it("accepts code fences and surrounding text", () => {
    expect(parseModelJson('Voici :\n```json\n[{"title":"A","content":"B"}]\n```')).toEqual([{ title: "A", content: "B" }]);
    expect(parseModelJson('{"general": false, "title": "x ] y", "content": "z"} merci')).toEqual({ general: false, title: "x ] y", content: "z" });
  });

  it("returns null on invalid JSON", () => {
    expect(parseModelJson("pas de JSON")).toBeNull();
    expect(parseModelJson("[{")).toBeNull();
  });
});

describe("test embeddings", () => {
  const cos = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  it("are normalised and make related texts closer than unrelated ones", () => {
    const a = fakeEmbedding("délai de paiement des factures du client", 1536);
    const b = fakeEmbedding("le client paie ses factures à 45 jours, délai de paiement", 1536);
    const c = fakeEmbedding("recette de la tarte aux pommes", 1536);
    expect(cos(a, a)).toBeCloseTo(1, 5);
    expect(cos(a, b)).toBeGreaterThan(0.25);
    expect(cos(a, c)).toBeLessThan(0.1);
  });
});

describe("memory passages in the prompt", () => {
  const passage = (position: number, extra: Partial<KnowledgePassage> = {}): KnowledgePassage => ({
    position,
    sourceType: "document_chunk",
    id: `id-${position}`,
    documentId: "doc",
    spaceId: "space",
    spaceKind: "client",
    clientName: "Client A",
    title: "Conditions.pdf",
    content: "Le Client A paie à 45 jours.",
    page: 2,
    charStart: 0,
    charEnd: 28,
    sourceDate: "2026-10-12T10:00:00Z",
    ...extra,
  });
  const base = { company: { name: "Atelier" }, user: { name: "Olivier" }, locale: "fr" as const, today: "2026-10-20" };

  it("numbers passages with their origin, page and date, and asks to cite them", () => {
    const prompt = buildSystemPrompt({ ...base, knowledge: [passage(1), passage(2, { sourceType: "memory_entry", spaceKind: "company", title: "Ton de voix", page: null })] });
    expect(prompt).toContain(KNOWLEDGE_RULES);
    expect(prompt).toContain('[S1] Client memory "Client A" · document "Conditions.pdf", page 2 · 2026-10-12');
    expect(prompt).toContain('[S2] Company memory · memory entry "Ton de voix"');
    expect(prompt).toMatch(/memory does not contain it/);
  });

  it("adds no knowledge section when nothing was found", () => {
    expect(buildSystemPrompt(base)).not.toContain("Company knowledge");
  });

  it("is part of the single context: every model receives the same passages", () => {
    const system = buildSystemPrompt({ ...base, knowledge: [passage(1)] });
    const a = buildChatContext({ system, history: [{ role: "user", text: "Délai ?" }], budgetTokens: 10_000 });
    const b = buildChatContext({ system, history: [{ role: "user", text: "Délai ?" }], budgetTokens: 10_000 });
    expect(a).toEqual(b);
    expect(a.system).toContain("[S1]");
  });
});

describe("which memories a conversation draws from", () => {
  const spaces: MemorySpace[] = [
    { spaceId: "company", kind: "company", clientId: null, canWrite: false, entryCount: 0, documentCount: 0 },
    { spaceId: "a", kind: "client", clientId: "client-a", canWrite: true, entryCount: 0, documentCount: 0 },
    { spaceId: "b", kind: "client", clientId: "client-b", canWrite: true, entryCount: 0, documentCount: 0 },
  ];
  it("uses company memory + the linked client's memory only", () => {
    expect(conversationScope(spaces, "client-a").map((s) => s.spaceId)).toEqual(["company", "a"]);
  });
  it("uses every readable memory when no client is linked", () => {
    expect(conversationScope(spaces, null).map((s) => s.spaceId)).toEqual(["company", "a", "b"]);
  });
  it("never adds a client memory the user cannot read", () => {
    expect(conversationScope(spaces.slice(0, 2), "client-b").map((s) => s.spaceId)).toEqual(["company"]);
  });
});

describe("documents are read on our server, page by page", () => {
  it("records where each PDF page starts and ends", async () => {
    const doc = await extractDocument(minimalPdf("Conditions generales", "Paiement a 45 jours"), "pdf", 400_000);
    expect(doc.pageCount).toBe(2);
    expect(doc.pages).toHaveLength(2);
    expect(doc.text.slice(doc.pages[1].start, doc.pages[1].end)).toContain("Paiement a 45 jours");
    expect(doc.truncated).toBe(false);
  });
});
