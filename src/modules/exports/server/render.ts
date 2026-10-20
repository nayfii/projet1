import "server-only";
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { cellNumber, plain, tablesOf, type Block, type Inline } from "../blocks";

/**
 * Exports of an AI answer (CLAUDE.md §4.7: "exportable"): Word and PDF for documents, CSV and Excel
 * for tables. Built on our server from the answer's text; nothing is sent elsewhere.
 */

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const runs = (parts: Inline[]) =>
  parts.map((p) => new TextRun({ text: p.text, bold: p.bold, italics: p.italic, font: p.code ? "Courier New" : undefined, break: p.text === "\n" ? 1 : undefined }));

export async function toDocx(title: string, blocks: Block[]): Promise<Buffer> {
  const children = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  for (const b of blocks) {
    if (b.type === "heading") children.push(new Paragraph({ children: runs(b.inlines), heading: HEADINGS[Math.min(b.level, 4) - 1] }));
    else if (b.type === "paragraph") children.push(new Paragraph({ children: runs(b.inlines), spacing: { after: 120 } }));
    else if (b.type === "quote") children.push(new Paragraph({ children: runs(b.inlines), indent: { left: 400 } }));
    else if (b.type === "code") children.push(...b.text.split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, font: "Courier New" })] })));
    else if (b.type === "rule") children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } } }));
    else if (b.type === "list")
      b.items.forEach((item, i) =>
        children.push(new Paragraph({ children: [new TextRun(b.ordered ? `${i + 1}. ` : "• "), ...runs(item)], indent: { left: 360, hanging: 260 } })),
      );
    else if (b.type === "table") {
      const row = (cells: string[], header: boolean) =>
        new TableRow({
          tableHeader: header,
          children: cells.map(
            (c) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: c, bold: header })], alignment: cellNumber(c) !== null ? AlignmentType.RIGHT : AlignmentType.LEFT })],
              }),
          ),
        });
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(b.header, true), ...b.rows.map((r) => row(r, false))] }) as unknown as Paragraph);
      children.push(new Paragraph({ text: "" }));
    }
  }
  const doc = new Document({ creator: "Workspace", title, styles: { default: { document: { run: { font: "Calibri", size: 22 } } } }, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

/** Characters outside the PDF standard fonts' encoding become close equivalents. */
const pdfText = (text: string) =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  ]/g, " ")
    .replace(/[→]/g, "->")
    .replace(/[^\x09\x0a\x20-\x7e -ÿŒœ€]/g, "");

export function toPdf(title: string, blocks: Block[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: pdfText(title) } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const width = doc.page.width - 112;
    const write = (parts: Inline[], size = 11, indent = 0) => {
      doc.fontSize(size);
      parts.forEach((p, i) => {
        doc.font(p.code ? "Courier" : p.bold && p.italic ? "Helvetica-BoldOblique" : p.bold ? "Helvetica-Bold" : p.italic ? "Helvetica-Oblique" : "Helvetica");
        doc.text(pdfText(p.text), { continued: i < parts.length - 1, width: width - indent, indent: i === 0 ? indent : 0 });
      });
      if (parts.length === 0) doc.text("");
    };
    doc.font("Helvetica-Bold").fontSize(18).text(pdfText(title)).moveDown(0.8);
    for (const b of blocks) {
      if (b.type === "heading") {
        doc.moveDown(0.4);
        write(b.inlines.map((p) => ({ ...p, bold: true })), b.level <= 1 ? 15 : b.level === 2 ? 13 : 12);
        doc.moveDown(0.3);
      } else if (b.type === "paragraph" || b.type === "quote") {
        write(b.inlines, 11, b.type === "quote" ? 16 : 0);
        doc.moveDown(0.5);
      } else if (b.type === "code") {
        doc.font("Courier").fontSize(9).text(pdfText(b.text), { width }).moveDown(0.5);
      } else if (b.type === "rule") {
        doc.moveTo(56, doc.y).lineTo(56 + width, doc.y).strokeColor("#cccccc").stroke().moveDown(0.5);
      } else if (b.type === "list") {
        b.items.forEach((item, i) => write([{ text: b.ordered ? `${i + 1}. ` : "- " }, ...item], 11, 12));
        doc.moveDown(0.5);
      } else if (b.type === "table") {
        const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
        const colW = width / cols;
        const drawRow = (cells: string[], header: boolean) => {
          doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(9);
          const heights = cells.map((c) => doc.heightOfString(pdfText(c), { width: colW - 8 }));
          const h = Math.max(14, ...heights) + 6;
          if (doc.y + h > doc.page.height - 56) doc.addPage();
          const top = doc.y;
          cells.forEach((c, i) => {
            doc.rect(56 + i * colW, top, colW, h).strokeColor("#d0d0d0").lineWidth(0.5).stroke();
            doc.text(pdfText(c), 56 + i * colW + 4, top + 3, { width: colW - 8, align: cellNumber(c) !== null ? "right" : "left" });
          });
          doc.x = 56;
          doc.y = top + h;
        };
        drawRow(b.header, true);
        b.rows.forEach((r) => drawRow(r, false));
        doc.moveDown(0.8);
      }
    }
    doc.end();
  });
}

/** A text cell that a spreadsheet would run as a formula (=, +, -, @) is kept as text. Numbers stay numbers. */
const inert = (v: string) => (/^[=+\-@\t\r]/.test(v) && cellNumber(v) === null ? `'${v}` : v);

/** The answer's tables as CSV (";" for French Excel, "," otherwise), UTF-8 with a BOM so accents open right. */
export function toCsv(blocks: Block[], separator: ";" | ","): string {
  const quote = (raw: string) => {
    const v = inert(raw);
    return v.includes(separator) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const tables = tablesOf(blocks);
  const lines = tables.flatMap((t, i) => [...(i > 0 ? [""] : []), t.header, ...t.rows].map((row) => (Array.isArray(row) ? row.map(quote).join(separator) : row)));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** The answer's tables as an Excel workbook, one sheet per table, numbers as numbers. */
export async function toXlsx(blocks: Block[], sheetName: (index: number) => string): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  tablesOf(blocks).forEach((t, i) => {
    const sheet = book.addWorksheet(sheetName(i).slice(0, 31));
    sheet.addRow(t.header).font = { bold: true };
    for (const r of t.rows) sheet.addRow(r.map((c) => cellNumber(c) ?? c));
    sheet.columns.forEach((column, c) => {
      column.width = Math.min(48, Math.max(10, ...[t.header[c] ?? "", ...t.rows.map((r) => r[c] ?? "")].map((v) => v.length + 2)));
    });
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

export const titleOf = (blocks: Block[], fallback: string) => {
  const heading = blocks.find((b) => b.type === "heading");
  return heading && heading.type === "heading" ? plain(heading.inlines) || fallback : fallback;
};
