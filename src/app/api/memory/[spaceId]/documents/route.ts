import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENT_TYPES, DOCUMENT_EXTENSIONS, extensionOf, MAX_DOCUMENT_BYTES } from "@/modules/documents/file-types";
import { contentMatchesExtension } from "@/modules/documents/server/extract";
import { processDocument } from "@/modules/memory/server/indexer";
import { myMemorySpaces } from "@/modules/memory/server/retrieval";
import { getMyQuota } from "@/modules/usage/server/quota";

export const maxDuration = 300;

/**
 * Adds a document to a memory. Requires write rights on the memory (checked here and by RLS).
 * The file is stored right away; reading, splitting and indexing run after the response.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/memory/[spaceId]/documents">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { spaceId } = await ctx.params;

  const supabase = await createClient();
  const space = (await myMemorySpaces(supabase, member.active.companyId)).find((s) => s.spaceId === spaceId);
  if (!space) return Response.json({ error: "not_found" }, { status: 404 });
  if (!space.canWrite) return Response.json({ error: "forbidden" }, { status: 403 });

  const quota = await getMyQuota(member.active.companyId);
  if (quota?.state.state === "blocked") {
    return Response.json({ error: quota.state.scope === "user" ? "quota_exceeded_user" : "quota_exceeded_company" }, { status: 402 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "validation" }, { status: 400 });
  const ext = extensionOf(file.name);
  if (!ext || !(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) return Response.json({ error: "attachment_type" }, { status: 415 });
  if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) return Response.json({ error: "document_too_large" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!contentMatchesExtension(bytes, ext)) return Response.json({ error: "attachment_type" }, { status: 415 });

  const filename = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 255) || `document.${ext}`;
  const storagePath = `${spaceId}/${randomUUID()}.${ext}`;
  const mime = ATTACHMENT_TYPES[ext].mime;
  const upload = await supabase.storage.from("memory-documents").upload(storagePath, bytes, { contentType: mime, upsert: false });
  if (upload.error) return Response.json({ error: "upload_failed" }, { status: 500 });

  const { data, error } = await supabase
    .from("documents")
    .insert({ space_id: spaceId, filename, mime_type: mime, size_bytes: file.size, storage_path: storagePath })
    .select("id, filename, status, created_at")
    .single();
  if (error || !data) {
    await supabase.storage.from("memory-documents").remove([storagePath]);
    return Response.json({ error: "upload_failed" }, { status: 500 });
  }

  after(() => processDocument(supabase, member, { id: data.id, spaceId }, bytes, ext));
  return Response.json({ id: data.id, filename: data.filename, status: data.status, createdAt: data.created_at });
}
