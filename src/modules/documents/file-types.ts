/**
 * File types accepted as chat attachments (and later as memory documents, Step 3).
 * Shared by the upload route (validation) and the composer (file picker filter).
 */
export const ATTACHMENT_TYPES = {
  pdf: { mime: "application/pdf", kind: "document" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document" },
  csv: { mime: "text/csv", kind: "document" },
  txt: { mime: "text/plain", kind: "document" },
  md: { mime: "text/markdown", kind: "document" },
  png: { mime: "image/png", kind: "image" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  gif: { mime: "image/gif", kind: "image" },
} as const;

export type AttachmentExtension = keyof typeof ATTACHMENT_TYPES;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
/** Text kept per document. Longer documents are cut and flagged as partially read. */
export const MAX_EXTRACTED_CHARS = 40_000;

export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export function extensionOf(filename: string): AttachmentExtension | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return ext in ATTACHMENT_TYPES ? (ext as AttachmentExtension) : null;
}
