import { randomUUID } from "node:crypto";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENT_TYPES, extensionOf, MAX_ATTACHMENT_BYTES } from "@/modules/documents/file-types";
import { contentMatchesExtension, extractText } from "@/modules/documents/server/extract";

/**
 * Uploads one file to a conversation. Checks type, size and content on our server, extracts the
 * text of documents here (nothing is sent to an AI to read the file), then stores the file in the
 * private bucket with the user's own session (Storage RLS: conversation participants only).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/attachments">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id: conversationId } = await ctx.params;

  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, company_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation || conversation.company_id !== member.active.companyId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "validation" }, { status: 400 });
  const ext = extensionOf(file.name);
  if (!ext) return Response.json({ error: "attachment_type" }, { status: 415 });
  if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) return Response.json({ error: "attachment_too_large" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!contentMatchesExtension(bytes, ext)) return Response.json({ error: "attachment_type" }, { status: 415 });

  const type = ATTACHMENT_TYPES[ext];
  let extracted: { text: string; truncated: boolean } = { text: "", truncated: false };
  if (type.kind === "document") {
    try {
      extracted = await extractText(bytes, ext);
    } catch {
      return Response.json({ error: "attachment_unreadable" }, { status: 422 });
    }
  }

  const filename = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 255) || `file.${ext}`;
  const storagePath = `${conversation.id}/${randomUUID()}.${ext}`;
  const upload = await supabase.storage
    .from("chat-attachments")
    .upload(storagePath, bytes, { contentType: type.mime, upsert: false });
  if (upload.error) return Response.json({ error: "upload_failed" }, { status: 500 });

  const { data, error } = await supabase
    .from("conversation_attachments")
    .insert({
      conversation_id: conversation.id,
      filename,
      mime_type: type.mime,
      size_bytes: file.size,
      storage_path: storagePath,
      kind: type.kind,
      extracted_text: type.kind === "document" ? extracted.text : null,
      text_truncated: extracted.truncated,
    })
    .select("id, filename, kind, size_bytes, text_truncated, extracted_text")
    .single();
  if (error || !data) {
    await supabase.storage.from("chat-attachments").remove([storagePath]);
    return Response.json({ error: "upload_failed" }, { status: 500 });
  }

  return Response.json({
    id: data.id,
    filename: data.filename,
    kind: data.kind,
    sizeBytes: data.size_bytes,
    truncated: data.text_truncated,
    hasText: data.kind === "image" || Boolean(data.extracted_text),
  });
}
