import { z } from "zod";

/**
 * A Scale document is a list of blocks. Hypotheses, observed facts and decisions are blocks of their
 * own kind, so they always look different from each other and from ordinary text.
 */
export const BLOCK_TYPES = ["h2", "h3", "p", "bullet", "numbered", "check", "hypothesis", "fact", "decision", "quote", "table", "link", "divider"] as const;
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
  hint: z.string().max(500).optional(),
});

export const blocksSchema = z.array(blockSchema).max(2000);

export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function block(type: BlockType, text = "", extra: Partial<Block> = {}): Block {
  return { id: newBlockId(), type, text, ...extra };
}

/** Plain text of a document, for search and previews. */
export function blocksText(blocks: Block[]): string {
  return blocks
    .map((b) => [b.text, b.url ?? "", ...(b.rows ?? []).flat()].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Markdown export (labels for hypotheses, facts and decisions are passed in the reader's language). */
export function blocksToMarkdown(title: string, blocks: Block[], labels: { hypothesis: string; fact: string; decision: string }): string {
  const lines: string[] = [`# ${title}`, ""];
  let n = 0;
  for (const b of blocks) {
    if (b.type !== "numbered") n = 0;
    switch (b.type) {
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
