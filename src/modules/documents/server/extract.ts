import "server-only";
import { MAX_EXTRACTED_CHARS, type AttachmentExtension } from "../file-types";

/**
 * Text extraction, entirely on our server (nothing is sent to an AI provider to read a file).
 * Chat attachments keep MAX_EXTRACTED_CHARS characters; memory documents keep more (see MAX_DOCUMENT_CHARS).
 */
export async function extractText(bytes: Uint8Array, ext: AttachmentExtension): Promise<{ text: string; truncated: boolean }> {
  const { text, truncated } = await extractDocument(bytes, ext, MAX_EXTRACTED_CHARS);
  return { text, truncated };
}

export type ExtractedDocument = {
  text: string;
  /** Where each PDF page sits in `text` (empty for other formats). */
  pages: { page: number; start: number; end: number }[];
  pageCount: number | null;
  truncated: boolean;
};

export async function extractDocument(bytes: Uint8Array, ext: AttachmentExtension, maxChars: number): Promise<ExtractedDocument> {
  let parts: string[];
  let pageCount: number | null = null;
  switch (ext) {
    case "pdf": {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const result = await pdfText(pdf, { mergePages: false });
      parts = result.text;
      pageCount = result.totalPages;
      break;
    }
    case "docx": {
      const mammoth = (await import("mammoth")).default;
      parts = [(await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value];
      break;
    }
    case "xlsx":
      parts = [await spreadsheetText(bytes)];
      break;
    case "csv":
    case "txt":
    case "md":
      parts = [decodeText(bytes)];
      break;
    default:
      return { text: "", pages: [], pageCount: null, truncated: false };
  }

  // Clean each page, then join, recording where each page starts and ends.
  let text = "";
  const pages: ExtractedDocument["pages"] = [];
  parts.forEach((part, i) => {
    const clean = part.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!clean) return;
    if (text) text += "\n\n";
    const start = text.length;
    text += clean;
    if (ext === "pdf") pages.push({ page: i + 1, start, end: text.length });
  });
  if (text.length <= maxChars) return { text, pages, pageCount, truncated: false };
  return {
    text: text.slice(0, maxChars),
    pages: pages.filter((p) => p.start < maxChars).map((p) => ({ ...p, end: Math.min(p.end, maxChars) })),
    pageCount,
    truncated: true,
  };
}

/** UTF-8 first (with or without BOM), Windows-1252 as a fallback for older French exports. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

async function spreadsheetText(bytes: Uint8Array): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const out: string[] = [];
  workbook.eachSheet((sheet) => {
    out.push(`## ${sheet.name}`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map(cellText);
      out.push(values.join(" | "));
    });
    out.push("");
  });
  return out.join("\n");
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: string; richText?: { text: string }[]; hyperlink?: string };
    if (v.result !== undefined) return cellText(v.result);
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text !== undefined) return v.text;
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/** Checks that the file content matches its extension (first bytes), so a renamed file is refused. */
export function contentMatchesExtension(bytes: Uint8Array, ext: AttachmentExtension): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (ext) {
    case "pdf":
      return starts(0x25, 0x50, 0x44, 0x46);
    case "docx":
    case "xlsx":
      return starts(0x50, 0x4b, 0x03, 0x04);
    case "png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "jpg":
    case "jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "webp":
      return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    default:
      // Text formats: refuse binary content (NUL bytes in the first kilobyte).
      return !bytes.slice(0, 1024).includes(0);
  }
}
