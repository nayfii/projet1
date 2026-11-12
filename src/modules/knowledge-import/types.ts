/** Knowledge import (CLAUDE.md §12): shared by the browser (reading the export) and the server (sorting). */

export const IMPORT_SOURCES = ["chatgpt", "claude", "gemini", "perplexity", "files"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** One unit read from an export: a conversation, a project's instructions, or a document. */
export type ImportedItem = {
  /** Opaque, stable reference (a hash): recognises the item when the same export is dropped again. */
  ref: string;
  kind: "conversation" | "project" | "document";
  title: string;
  /** ISO date, when the export gives one. */
  date: string | null;
  /** What the PERSON wrote (their messages, instructions, document text), not the assistant's answers. */
  text: string;
};

export type ParsedExport = {
  source: ImportSource;
  items: ImportedItem[];
  /** Items found in the export but left out here (empty, too short, attachments of third parties). */
  skipped: number;
  /** Files sent to our server to read their text (PDF, Word): read there, never stored. */
  binaries: { name: string; kind: "pdf" | "docx"; data: Uint8Array }[];
  warnings: ImportWarning[];
};

export type ImportWarning = "dangerous_path" | "nested_archive" | "unsupported_file" | "documents_not_imported" | "truncated" | "binary_too_large";

export type ImportErrorCode = "archive_too_large" | "suspicious_archive" | "invalid_archive" | "unrecognised_format" | "nothing_found" | "too_many_files";

export class ImportReadError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
  }
}

/** Limits on what is read (protection against oversized or malicious archives) and analysed (cost). */
export const IMPORT_LIMITS = {
  /** The archive as dropped. */
  archiveBytes: 4 * 1024 ** 3,
  /** One file inside the archive, once decompressed (a ChatGPT conversations.json can be large). */
  entryBytes: 400 * 1024 ** 2,
  /** All files read inside the archive, decompressed. */
  totalBytes: 800 * 1024 ** 2,
  /** Decompressed / compressed: beyond this on a large file, the archive is treated as a "zip bomb". */
  ratio: 120,
  entries: 50_000,
  /** PDF and Word files are read by our server: one request each. */
  binaryBytes: 4 * 1024 ** 2,
  binaries: 20,
  /** Text kept per item for the analysis (the person's own words; the start of long ones). */
  itemChars: 6000,
  /** Shorter than this, an item says nothing durable. */
  minChars: 40,
  /** Items analysed per import (the most recent first): the analysis uses the company's credits. */
  analysed: 300,
  /** Items sent to the server per request. */
  batch: 5,
} as const;

/** What the analysis proposes for one piece of knowledge (before the person decides). */
export const IMPORT_LEVELS = ["personal", "team", "company", "client", "project"] as const;
export type ImportLevel = (typeof IMPORT_LEVELS)[number];
