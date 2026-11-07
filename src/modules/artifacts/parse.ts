/**
 * Artifacts: substantial content an AI writes to keep, edit and export (a document, a spreadsheet, a
 * presentation, a code file). Any model can make one: it writes a fenced block in its answer,
 *
 *     ````artifact-document
 *     id: facture-martin
 *     title: Facture — Boulangerie Martin
 *
 *     …Markdown…
 *     ````
 *
 * and Cendr shows it in the workspace on the right, keeps its versions (the same id written again,
 * by the model or by a person who edits it) and exports it (Word, PDF, Excel, CSV, text). Nothing
 * here depends on the provider: the model writes text, Cendr reads, shows and exports it.
 */

export const ARTIFACT_KINDS = ["document", "sheet", "slides", "code"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type Artifact = {
  kind: ArtifactKind;
  /** Stable across versions: the id the model gave, else made from the title. */
  key: string;
  /** Empty when the model gave none: the interface then names it by its kind, in the person's language. */
  title: string;
  /** Code artifacts: the language (python, ts…), for the file name and the view. */
  lang: string | null;
  /** The content without its header lines (Markdown; slides separated by "---"; code as is). */
  body: string;
};

export type ArtifactVersion = Artifact & {
  messageId: string;
  /** Position among the artifacts of its message (exports name it). */
  index: number;
  /** 1, 2, 3… in the conversation's order. */
  version: number;
  role: "assistant" | "user";
  createdAt: string;
};

const FENCE_OPEN = /^(`{3,}|~{3,})\s*artifact-(document|sheet|slides|code)\b(.*)$/;
const HEADER = /^(id|title|lang|language)\s*:\s*(.*)$/i;

export const isArtifactKind = (value: string): value is ArtifactKind => (ARTIFACT_KINDS as readonly string[]).includes(value);

/** "Facture — Boulangerie Martin" → "facture-boulangerie-martin". */
export function artifactKey(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "artifact"
  );
}

/** Reads the header lines (id, title, lang) at the top of a block, then the content. */
export function readArtifact(kind: ArtifactKind, raw: string, infoRest = ""): Artifact {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < lines.length && i < 6) {
    const m = HEADER.exec(lines[i].trim());
    if (!m) break;
    fields[m[1].toLowerCase() === "language" ? "lang" : m[1].toLowerCase()] = m[2].trim();
    i++;
  }
  const body = lines.slice(i).join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  // A title also comes from the info string (```artifact-document title="…") or the first heading.
  const infoTitle = /title\s*=\s*"([^"]+)"/.exec(infoRest)?.[1];
  const heading = /^#{1,3}\s+(.+)$/m.exec(body)?.[1];
  const title = (fields.title || infoTitle || heading || "").replace(/^["']|["']$/g, "").trim().slice(0, 120);
  const key = artifactKey(fields.id || title);
  const lang = kind === "code" ? (fields.lang || /lang\s*=\s*"?([\w+#-]+)/.exec(infoRest)?.[1] || null) : null;
  return { kind, key, title, lang, body };
}

/** The finished artifact blocks of an answer, in order (a block still being written is left out). */
export function artifactsIn(markdown: string): Artifact[] {
  const out: Artifact[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i].trim());
    if (!open) continue;
    const fence = open[1];
    const closing = new RegExp(`^${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !closing.test(lines[j].trim())) j++;
    if (j >= lines.length) break; // not closed yet: still streaming
    out.push(readArtifact(open[2] as ArtifactKind, lines.slice(i + 1, j).join("\n"), open[3] ?? ""));
    i = j;
  }
  return out;
}

/** Whether an answer has started an artifact block it has not closed yet (still writing it). */
export function hasOpenArtifact(markdown: string): boolean {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i].trim());
    if (!open) continue;
    const closing = new RegExp(`^${open[1][0] === "`" ? "`" : "~"}{${open[1].length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !closing.test(lines[j].trim())) j++;
    if (j >= lines.length) return true;
    i = j;
  }
  return false;
}

/** Back to the fenced form (four backticks, so code fences inside stay intact). */
export function serializeArtifact(a: Pick<Artifact, "kind" | "key" | "title" | "lang" | "body">): string {
  const header = [`id: ${a.key}`, `title: ${a.title}`, ...(a.kind === "code" && a.lang ? [`lang: ${a.lang}`] : [])];
  return ["````artifact-" + a.kind, ...header, "", a.body.replace(/\s+$/, ""), "````"].join("\n");
}

/** Slides are separated by a line holding only "---". */
export function slidesOf(body: string): string[] {
  return body
    .split(/\n\s*-{3,}\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Every artifact of a conversation, grouped by key, versions numbered in the conversation's order. */
export function collectArtifacts(messages: { id: string; role: string; content: string; createdAt: string }[]): Map<string, ArtifactVersion[]> {
  const byKey = new Map<string, ArtifactVersion[]>();
  for (const m of messages) {
    if (m.role !== "assistant" && m.role !== "user") continue;
    artifactsIn(m.content).forEach((a, index) => {
      const list = byKey.get(a.key) ?? [];
      list.push({ ...a, messageId: m.id, index, version: list.length + 1, role: m.role as "assistant" | "user", createdAt: m.createdAt });
      byKey.set(a.key, list);
    });
  }
  return byKey;
}

/** File extension for a code artifact's language. */
export function codeExtension(lang: string | null): string {
  const l = (lang ?? "").toLowerCase();
  const map: Record<string, string> = {
    python: "py", py: "py", typescript: "ts", ts: "ts", javascript: "js", js: "js", tsx: "tsx", jsx: "jsx", html: "html", css: "css",
    sql: "sql", json: "json", bash: "sh", sh: "sh", shell: "sh", yaml: "yml", yml: "yml", java: "java", go: "go", rust: "rs", php: "php", ruby: "rb",
    csharp: "cs", "c#": "cs", cpp: "cpp", "c++": "cpp", c: "c", swift: "swift", kotlin: "kt", r: "r", markdown: "md", md: "md", vba: "bas",
  };
  return map[l] ?? "txt";
}

export type SheetTable = { header: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** The Markdown tables of a spreadsheet artifact (other lines are ignored). */
export function parseTables(body: string): SheetTable[] {
  const tables: SheetTable[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|") || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) continue;
    const header = cells(lines[i]);
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith("|")) {
      const row = cells(lines[j]);
      rows.push(header.map((_, c) => row[c] ?? ""));
      j++;
    }
    tables.push({ header, rows });
    i = j - 1;
  }
  return tables;
}

/** Tables back to Markdown; numbers keep right alignment. */
export function tablesToMarkdown(tables: SheetTable[]): string {
  const esc = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const numeric = (t: SheetTable, c: number) => t.rows.length > 0 && t.rows.every((r) => !r[c] || /^-?[\d\s.,]+%?$/.test(r[c].trim()));
  return tables
    .map((t) =>
      [
        `| ${t.header.map(esc).join(" | ")} |`,
        `|${t.header.map((_, c) => (numeric(t, c) ? "---:" : "---")).join("|")}|`,
        ...t.rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
      ].join("\n"),
    )
    .join("\n\n");
}

/** A person's edit, posted to the conversation: a short line, then the artifact in full. */
export function editMessage(intro: string, artifact: Pick<Artifact, "kind" | "key" | "title" | "lang" | "body">): string {
  return `${intro}\n\n${serializeArtifact(artifact)}`;
}

/** A message's own text before its first artifact block (a person's edit shows it in the bubble). */
export function textBeforeArtifacts(markdown: string): string {
  const lines = markdown.split("\n");
  const first = lines.findIndex((l) => FENCE_OPEN.test(l.trim()));
  return (first < 0 ? markdown : lines.slice(0, first).join("\n")).trim();
}

/** The inside of an artifact's block (header lines and content), as a card reads it. */
export function artifactSource(a: Pick<Artifact, "kind" | "key" | "title" | "lang" | "body">): string {
  return serializeArtifact(a).split("\n").slice(1, -1).join("\n");
}
