import { describe, expect, it } from "vitest";
import { readChatGpt, readClaude, readGeminiActivityHtml, htmlToText } from "@/modules/knowledge-import/adapters";
import { exportFingerprint, isDangerousPath, readExport } from "@/modules/knowledge-import/archive";
import { checkProposal, filterImportedText, hasSecret, topicsIn } from "@/modules/knowledge-import/privacy";
import { ImportReadError } from "@/modules/knowledge-import/types";
import { asFile, bombZip, chatgptZip, CHATGPT_CONVERSATIONS, claudeZip, CLAUDE_CONVERSATIONS, hostileZip, perplexityZip, takeoutZip } from "../helpers/exports";

const texts = (items: { text: string }[]) => items.map((i) => i.text).join("\n---\n");

describe("reading exports (synthetic, shaped like the real ones)", () => {
  it("ChatGPT: follows the branch the person last saw, keeps only their own messages, skips empty chats", () => {
    const { items, skipped } = readChatGpt(CHATGPT_CONVERSATIONS);
    expect(items).toHaveLength(5);
    expect(skipped).toBe(1); // "merci"
    const all = texts(items);
    expect(all).toContain("chaque devis est relu par un associé");
    expect(all).not.toContain("Réponse de l'assistant");
    expect(all).not.toContain("Ancienne version du message");
    expect(items[0].date).toMatch(/^2026-09-02T/);
  });

  it("Claude: chat_messages/sender and messages/role variants, human messages and text blocks", () => {
    const { items } = readClaude(CLAUDE_CONVERSATIONS);
    expect(items.map((i) => i.title)).toEqual(["Onboarding des nouveaux clients", "Notes perso"]);
    expect(items[0].text).toContain("trois ateliers");
    expect(items[0].text).toContain("maquette le 15 mai");
    expect(items[0].text).not.toContain("Voici une proposition");
  });

  it("reads a ChatGPT archive in streaming, without its duplicate chat.html or account files", async () => {
    let progress = 0;
    const parsed = await readExport([asFile(chatgptZip(), "export.zip")], null, (read) => (progress = read));
    expect(parsed.source).toBe("chatgpt");
    expect(parsed.items).toHaveLength(5);
    expect(texts(parsed.items)).not.toContain("duplicate of conversations");
    expect(texts(parsed.items)).not.toContain("claire@example.test");
    expect(progress).toBeGreaterThan(0);
    // Most recent first.
    expect(parsed.items[0].title).toBe("Mail relance facture");
  });

  it("reads a Claude archive: conversations and projects' instructions, never projects' documents", async () => {
    const parsed = await readExport([asFile(claudeZip(), "data.zip")], null);
    expect(parsed.source).toBe("claude");
    expect(parsed.items.map((i) => i.kind).sort()).toEqual(["conversation", "conversation", "project"]);
    expect(texts(parsed.items)).toContain("Toujours structurer en contexte");
    expect(texts(parsed.items)).not.toContain("Contrat confidentiel d'un tiers");
    expect(parsed.warnings).toContain("documents_not_imported");
  });

  it("reads Gemini from a Google Takeout: only the Gemini activity, prompts grouped by day", async () => {
    const parsed = await readExport([asFile(takeoutZip(), "takeout-20261101.zip")], null);
    expect(parsed.source).toBe("gemini");
    expect(parsed.items).toHaveLength(2);
    expect(texts(parsed.items)).toContain("politique de télétravail");
    expect(texts(parsed.items)).not.toMatch(/Prompted|Searched for|weather|Takeout index/);
  });

  it("reads the HTML variant of the Takeout activity", () => {
    const html = `<div class="outer-cell mdl-cell"><div class="content-cell mdl-cell">Prompted&nbsp;Liste les étapes de notre process d'achat fournisseur en cinq points<br>Oct 1, 2026, 9:00:00 AM CET<br></div></div>`;
    const { items } = readGeminiActivityHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Liste les étapes de notre process d'achat fournisseur en cinq points");
  });

  it("recognises Perplexity Markdown threads, alone or zipped", async () => {
    const parsed = await readExport([asFile(perplexityZip(), "Perplexity_Export.zip")], null);
    expect(parsed.source).toBe("perplexity");
    expect(parsed.items[0].title).toBe("Quels sont les délais légaux de paiement entre entreprises en France ?");
  });

  it("refuses dangerous paths and nested archives, and keeps the rest", async () => {
    expect(isDangerousPath("../../etc/passwd")).toBe(true);
    expect(isDangerousPath("C:\\Windows\\x.md")).toBe(true);
    expect(isDangerousPath("notes/a.md")).toBe(false);
    const parsed = await readExport([asFile(hostileZip(), "notes.zip")], "files");
    expect(parsed.warnings).toEqual(expect.arrayContaining(["dangerous_path", "nested_archive"]));
    expect(parsed.items.map((i) => i.title)).toEqual(["Process qualité"]);
  });

  it("stops a zip bomb before it fills the memory", async () => {
    const bomb = bombZip(120);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(readExport([asFile(bomb, "export.zip")], null)).rejects.toMatchObject({ code: "suspicious_archive" });
  });

  it("explains what is wrong with a broken or unknown file", async () => {
    await expect(readExport([asFile("not a zip at all", "export.zip")], null)).rejects.toBeInstanceOf(ImportReadError);
    await expect(readExport([asFile(JSON.stringify({ hello: "world" }), "data.json")], null)).rejects.toMatchObject({ code: "unrecognised_format" });
    await expect(readExport([asFile("{broken", "conversations.json")], null)).rejects.toMatchObject({ code: "invalid_archive" });
  });

  it("gives the same fingerprint to the same export dropped twice (resume)", async () => {
    const a = await readExport([asFile(chatgptZip(), "export.zip")], null);
    const b = await readExport([asFile(chatgptZip(), "export.zip")], null);
    expect(exportFingerprint(a, ["export.zip"])).toBe(exportFingerprint(b, ["export.zip"]));
  });

  it("turns HTML into text without scripts", () => {
    expect(htmlToText("<p>Bonjour&nbsp;<b>équipe</b></p><script>alert(1)</script>")).toBe("Bonjour équipe");
  });
});

describe("privacy filter (no AI involved)", () => {
  const conversation = (title: string) => {
    const c = CHATGPT_CONVERSATIONS.find((x) => x.title === title)!;
    return readChatGpt([c]).items[0];
  };

  it("leaves out a conversation about health or love life entirely", () => {
    for (const title of ["Conseils santé", "Message pour Julien"]) {
      const c = conversation(title);
      const result = filterImportedText(c.title, c.text);
      expect(result.kept).toBe(false);
    }
    expect(filterImportedText("Mon divorce", "Comment organiser la semaine ?").kept).toBe(false);
  });

  it("removes private paragraphs and secrets from a work conversation, keeps the work", () => {
    const c = conversation("Mail relance facture");
    const result = filterImportedText(c.title, c.text);
    expect(result.kept).toBe(true);
    if (!result.kept) return;
    expect(result.text).toContain("45 jours fin de mois");
    expect(result.text).toContain("ton de l'agence est direct");
    expect(result.text).not.toMatch(/salaire|crédit immobilier/);
    expect(result.removedParagraphs).toBe(1);

    const atlas = conversation("Préparation rendez-vous client Atlas");
    const r2 = filterImportedText(atlas.title, atlas.text);
    expect(r2.kept).toBe(true);
    if (!r2.kept) return;
    expect(r2.text).toContain("reporting hebdomadaire");
    expect(r2.text).not.toContain("Sup3rS3cret");
    expect(r2.removedSecrets).toBeGreaterThan(0);
  });

  it("finds secrets: keys, passwords, card and bank numbers with valid checksums", () => {
    expect(hasSecret("ma clé sk-proj-abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
    expect(hasSecret("password: hunter2")).toBe(true);
    expect(hasSecret("IBAN FR76 3000 6000 0112 3456 7890 189")).toBe(true);
    expect(hasSecret("carte 4970 1012 3456 7890")).toBe(false); // fails Luhn: an order number, not a card
    expect(hasSecret("carte 4111 1111 1111 1111")).toBe(true);
    expect(hasSecret("Notre délai de paiement est de 45 jours.")).toBe(false);
  });

  it("knows private topics in French and English, without flagging ordinary work words", () => {
    expect([...topicsIn("Mon médecin m'a prescrit un traitement").keys()]).toContain("health");
    expect([...topicsIn("my girlfriend and I broke up").keys()]).toContain("intimate");
    expect([...topicsIn("Je vote pour ce parti politique").keys()]).toContain("politics");
    expect(topicsIn("Le client Atlas veut un reporting hebdomadaire, ton direct et chaleureux.").size).toBe(0);
    expect(topicsIn("Nous rénovons l'église Saint-Martin pour la mairie.").size).toBe(0);
  });

  it("checks each proposal again: drops secrets and private ones, keeps doubtful ones apart", () => {
    expect(checkProposal("Délais", "Le délai de paiement standard est de 45 jours fin de mois.")).toBe("keep");
    expect(checkProposal("Accès", "mot de passe: abc123")).toBe("drop");
    expect(checkProposal("Santé", "Suit une thérapie et prend un médicament.")).toBe("drop");
    expect(checkProposal("Organisation", "Prévient l'équipe quand il pose un arrêt maladie.")).toBe("doubtful");
  });
});
