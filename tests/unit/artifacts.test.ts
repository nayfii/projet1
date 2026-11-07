import { describe, expect, it } from "vitest";
import {
  artifactKey,
  artifactSource,
  artifactsIn,
  codeExtension,
  collectArtifacts,
  editMessage,
  hasOpenArtifact,
  parseTables,
  readArtifact,
  serializeArtifact,
  slidesOf,
  tablesToMarkdown,
  textBeforeArtifacts,
} from "@/modules/artifacts/parse";

const invoice = (total: number) =>
  ["Voici la facture.", "", "````artifact-document", "id: facture-martin", "title: Facture — Boulangerie Martin", "", "# Facture", "", "```", "code inside", "```", "", `Total : ${total} €`, "````", "", "À vérifier : la TVA."].join("\n");

describe("artifacts (provider-independent blocks)", () => {
  it("reads the finished blocks of an answer: kind, id, title, content (code fences inside kept)", () => {
    const [a] = artifactsIn(invoice(1200));
    expect(a).toMatchObject({ kind: "document", key: "facture-martin", title: "Facture — Boulangerie Martin", lang: null });
    expect(a.body).toContain("```\ncode inside\n```");
    expect(a.body.endsWith("Total : 1200 €")).toBe(true);
  });

  it("leaves out a block still being written, and says one is open", () => {
    const partial = "Voici :\n\n````artifact-slides\nid: deck\ntitle: Plan\n\n# Un";
    expect(artifactsIn(partial)).toEqual([]);
    expect(hasOpenArtifact(partial)).toBe(true);
    expect(hasOpenArtifact(invoice(1))).toBe(false);
  });

  it("works without an id or title (from the first heading) and with three backticks", () => {
    const [a] = artifactsIn("```artifact-sheet\n# Budget été\n| A | B |\n|---|---|\n| 1 | 2 |\n```");
    expect(a.title).toBe("Budget été");
    expect(a.key).toBe("budget-ete");
    expect(artifactKey("  Éloïse & Co — 2027 ")).toBe("eloise-co-2027");
  });

  it("numbers versions across the conversation: the AI's and a person's edit, by id", () => {
    const versions = collectArtifacts([
      { id: "m1", role: "assistant", content: invoice(1200), createdAt: "2026-11-07T10:00:00Z" },
      { id: "m2", role: "user", content: editMessage("J'ai modifié « Facture ».", { ...artifactsIn(invoice(1200))[0], body: "# Facture\n\nTotal : 1300 €" }), createdAt: "2026-11-07T10:05:00Z" },
      { id: "m3", role: "assistant", content: invoice(1800), createdAt: "2026-11-07T10:06:00Z" },
    ]).get("facture-martin")!;
    expect(versions.map((v) => [v.version, v.role, v.messageId])).toEqual([
      [1, "assistant", "m1"],
      [2, "user", "m2"],
      [3, "assistant", "m3"],
    ]);
    expect(versions[1].body).toContain("1300");
    expect(textBeforeArtifacts(`J'ai modifié « Facture ».\n\n${serializeArtifact(versions[1])}`)).toBe("J'ai modifié « Facture ».");
  });

  it("round-trips through its source (what a card reads)", () => {
    const a = artifactsIn(invoice(5))[0];
    expect(readArtifact("document", artifactSource(a))).toMatchObject({ key: a.key, title: a.title, body: a.body });
  });

  it("splits slides on lines of dashes", () => {
    expect(slidesOf("# Un\n- a\n\n---\n\n# Deux\n\n----\n# Trois")).toEqual(["# Un\n- a", "# Deux", "# Trois"]);
  });

  it("edits spreadsheet tables and writes them back (numbers right-aligned, pipes escaped)", () => {
    const tables = parseTables("| Poste | Janvier |\n|---|---:|\n| Pub | 1200 |\n| Salons \\| stands | 0 |");
    expect(tables).toEqual([{ header: ["Poste", "Janvier"], rows: [["Pub", "1200"], ["Salons | stands", "0"]] }]);
    tables[0].rows[0][1] = "1 500";
    expect(tablesToMarkdown(tables)).toBe("| Poste | Janvier |\n|---|---:|\n| Pub | 1 500 |\n| Salons \\| stands | 0 |");
  });

  it("names code files by their language", () => {
    expect(codeExtension("Python")).toBe("py");
    expect(codeExtension("sql")).toBe("sql");
    expect(codeExtension(null)).toBe("txt");
  });
});
