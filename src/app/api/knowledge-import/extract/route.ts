import { memberOrNull } from "@/lib/auth/guards";
import { contentMatchesExtension, extractDocument } from "@/modules/documents/server/extract";
import { clip } from "@/modules/knowledge-import/adapters";
import { IMPORT_LIMITS } from "@/modules/knowledge-import/types";

/**
 * Knowledge import: reads the text of one PDF or Word file (a Perplexity thread exported as PDF, a
 * note…) on our server, in memory. The file is not stored and its text is not logged; the text goes
 * back to the person's browser, which sends it on like any other imported item.
 */
export async function POST(request: Request) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "validation" }, { status: 400 });
  const ext = /\.(pdf|docx)$/i.exec(file.name)?.[1]?.toLowerCase() as "pdf" | "docx" | undefined;
  if (!ext) return Response.json({ error: "attachment_type" }, { status: 415 });
  if (file.size === 0 || file.size > IMPORT_LIMITS.binaryBytes) return Response.json({ error: "attachment_too_large" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!contentMatchesExtension(bytes, ext)) return Response.json({ error: "attachment_type" }, { status: 415 });
  try {
    const doc = await extractDocument(bytes, ext, IMPORT_LIMITS.itemChars * 2);
    return Response.json({ text: clip(doc.text) });
  } catch {
    return Response.json({ error: "attachment_unreadable" }, { status: 422 });
  }
}
