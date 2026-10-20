import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseChartSpec } from "@/modules/conversations/chart-spec";

/**
 * An AI answer (Markdown) as simple blocks, the common ground of the Word, PDF, CSV and Excel exports.
 * Citation marks ([S1]) are dropped; a chart becomes the table of its data.
 */

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
export type Block =
  | { type: "heading"; level: number; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; text: string }
  | { type: "quote"; inlines: Inline[] }
  | { type: "rule" };

type Node = { type: string; value?: string; depth?: number; ordered?: boolean; lang?: string | null; children?: Node[] };

const CITATION = /\s?\[S\d{1,2}\]/g;

function inlines(node: Node, style: Omit<Inline, "text"> = {}): Inline[] {
  switch (node.type) {
    case "text":
      return [{ text: (node.value ?? "").replace(CITATION, ""), ...style }];
    case "inlineCode":
      return [{ text: node.value ?? "", ...style, code: true }];
    case "strong":
      return (node.children ?? []).flatMap((c) => inlines(c, { ...style, bold: true }));
    case "emphasis":
      return (node.children ?? []).flatMap((c) => inlines(c, { ...style, italic: true }));
    case "break":
      return [{ text: "\n", ...style }];
    default:
      return (node.children ?? []).flatMap((c) => inlines(c, style));
  }
}

export const plain = (parts: Inline[]) => parts.map((p) => p.text).join("").trim();

function toBlocks(node: Node): Block[] {
  switch (node.type) {
    case "heading":
      return [{ type: "heading", level: node.depth ?? 1, inlines: inlines(node) }];
    case "paragraph":
      return [{ type: "paragraph", inlines: inlines(node) }];
    case "list":
      return [
        {
          type: "list",
          ordered: Boolean(node.ordered),
          // A list item's paragraphs are joined; nested lists are flattened into the item.
          items: (node.children ?? []).map((item) => (item.children ?? []).flatMap((c, i) => [...(i > 0 ? [{ text: " " }] : []), ...inlines(c)])),
        },
      ];
    case "table": {
      const [head, ...rows] = (node.children ?? []).map((row) => (row.children ?? []).map((cell) => plain(inlines(cell))));
      return head ? [{ type: "table", header: head, rows }] : [];
    }
    case "code": {
      const spec = node.lang === "chart" ? parseChartSpec(node.value ?? "") : null;
      if (spec) {
        return [
          ...(spec.title ? [{ type: "paragraph" as const, inlines: [{ text: spec.title, bold: true }] }] : []),
          { type: "table", header: ["", ...spec.series.map((s) => s.name)], rows: spec.labels.map((label, i) => [label, ...spec.series.map((s) => String(s.values[i]))]) },
        ];
      }
      return [{ type: "code", text: node.value ?? "" }];
    }
    case "blockquote":
      return [{ type: "quote", inlines: (node.children ?? []).flatMap((c) => inlines(c)) }];
    case "thematicBreak":
      return [{ type: "rule" }];
    default:
      return (node.children ?? []).flatMap(toBlocks);
  }
}

export function markdownToBlocks(markdown: string): Block[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Node;
  return (tree.children ?? []).flatMap(toBlocks).filter((b) => !(b.type === "paragraph" && !plain(b.inlines)));
}

export const tablesOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { type: "table" }> => b.type === "table");

/** Whether an answer has a table (or a chart) to export as CSV or Excel. */
export function hasTable(markdown: string): boolean {
  return /^\s*\|.+\|\s*\n\s*\|[\s:|-]+\|/m.test(markdown) || /```chart\s*\n/.test(markdown);
}

/** A number as it should go into a spreadsheet cell ("1 234,50 €" → 1234.5), or null if it is text. */
export function cellNumber(value: string): number | null {
  const v = value.replace(/[\s  ]/g, "").replace(/[€$£%]$/, "").replace(/^[€$£]/, "");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(v) || /^-?\d+,\d+$/.test(v)) return Number(v.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) return Number(v.replace(/,/g, ""));
  return null;
}
