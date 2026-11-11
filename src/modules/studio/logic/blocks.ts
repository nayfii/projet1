import { z } from "zod";

/**
 * A Knowledge document is a list of blocks (like Notion's). Text blocks may hold light formatting
 * (**bold**, *italic*, [label](https://…)) and links to other documents ([[doc:<id>]], shown with the
 * document's current title). Hypotheses, observed facts and decisions keep blocks of their own kind.
 */
export const BLOCK_TYPES = ["h2", "h3", "p", "bullet", "numbered", "check", "toggle", "quote", "callout", "image", "table", "link", "divider", "hypothesis", "fact", "decision"] as const;
/** What the "/" menu offers, in this order (older kinds still open and display). */
export const MENU_TYPES = ["p", "h2", "h3", "bullet", "numbered", "check", "toggle", "quote", "callout", "table", "image", "link", "divider", "hypothesis", "fact", "decision"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type Block = {
  id: string;
  type: BlockType;
  text: string;
  /** Checklist items. */
  checked?: boolean;
  /** Link blocks. */
  url?: string;
  /** Table blocks: rows of cells, the first row is the header. */
  rows?: string[][];
  /** Toggle blocks: what shows when opened (the summary is `text`). */
  body?: string;
  /** Toggle blocks: shown open. */
  open?: boolean;
  /** Image blocks: the file in our private storage (`text` is the caption). */
  path?: string;
  /** Guidance shown while the block is empty (templates). Never content. */
  hint?: string;
};

const blockSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(BLOCK_TYPES),
  text: z.string().max(20_000),
  checked: z.boolean().optional(),
  url: z
    .string()
    .max(2000)
    .refine((u) => u === "" || /^https?:\/\//i.test(u), "url")
    .optional(),
  rows: z.array(z.array(z.string().max(2000)).max(12)).max(60).optional(),
  body: z.string().max(20_000).optional(),
  open: z.boolean().optional(),
  path: z
    .string()
    .max(400)
    .regex(/^doc\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$/)
    .optional(),
  hint: z.string().max(500).optional(),
});

export const blocksSchema = z.array(blockSchema).max(2000);

export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function block(type: BlockType, text = "", extra: Partial<Block> = {}): Block {
  return { id: newBlockId(), type, text, ...extra };
}

/** Plain text of a document, for previews (search uses the same rule in the database). */
export function blocksText(blocks: Block[]): string {
  return blocks
    .map((b) => [b.text, b.body ?? "", b.url ?? "", ...(b.rows ?? []).flat()].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
}

/** The documents a document links to ([[doc:<id>]] in its text). */
export function linkedDocumentIds(blocks: Block[]): string[] {
  const ids = new Set<string>();
  for (const b of blocks) for (const m of `${b.text} ${b.body ?? ""}`.matchAll(/\[\[doc:([0-9a-f-]{36})\]\]/g)) ids.add(m[1]);
  return [...ids];
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Markdown export (labels in the reader's language; links to documents become their titles). */
export function blocksToMarkdown(
  title: string,
  blocks: Block[],
  labels: { hypothesis: string; fact: string; decision: string; image: string },
  docTitle: (id: string) => string | null = () => null,
): string {
  const lines: string[] = [`# ${title}`, ""];
  let n = 0;
  const inline = (text: string) => text.replace(/\[\[doc:([0-9a-f-]{36})\]\]/g, (_, id: string) => docTitle(id) ?? "");
  for (const raw of blocks) {
    const b = { ...raw, text: inline(raw.text), body: raw.body === undefined ? undefined : inline(raw.body) };
    if (b.type !== "numbered") n = 0;
    switch (b.type) {
      case "toggle":
        lines.push(`**${b.text}**`, "", b.body ?? "", "");
        break;
      case "callout":
        lines.push(`> ${b.text}`, "");
        break;
      case "image":
        lines.push(`*${labels.image}${b.text ? ` — ${b.text}` : ""}*`, "");
        break;
      case "h2":
        lines.push(`## ${b.text}`, "");
        break;
      case "h3":
        lines.push(`### ${b.text}`, "");
        break;
      case "bullet":
        lines.push(`- ${b.text}`);
        break;
      case "numbered":
        lines.push(`${++n}. ${b.text}`);
        break;
      case "check":
        lines.push(`- [${b.checked ? "x" : " "}] ${b.text}`);
        break;
      case "hypothesis":
        lines.push(`> **${labels.hypothesis}** — ${b.text}`, "");
        break;
      case "fact":
        lines.push(`> **${labels.fact}** — ${b.text}`, "");
        break;
      case "decision":
        lines.push(`> **${labels.decision}** — ${b.text}`, "");
        break;
      case "quote":
        lines.push(`> ${b.text}`, "");
        break;
      case "link":
        lines.push(`[${b.text || b.url}](${b.url ?? ""})`, "");
        break;
      case "divider":
        lines.push("---", "");
        break;
      case "table": {
        const rows = b.rows ?? [];
        if (rows.length) {
          const width = Math.max(...rows.map((r) => r.length));
          const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
          lines.push(`| ${pad(rows[0]).map(escapeCell).join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`);
          for (const r of rows.slice(1)) lines.push(`| ${pad(r).map(escapeCell).join(" | ")} |`);
          lines.push("");
        }
        break;
      }
      default:
        lines.push(b.text, "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
