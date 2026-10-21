import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { MAX_VIDEO_BYTES, VIDEO_TYPES, videoContentMatches, videoExtensionOf } from "@/modules/render/formats";

const bodySchema = z.object({
  path: z.string().max(200),
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  media: z
    .object({ duration: z.number().finite().min(0).max(36_000), width: z.number().int().min(0).max(10_000), height: z.number().int().min(0).max(10_000) })
    .nullable(),
});

/**
 * Registers a video clip (Video Editor) that the browser has just uploaded to the private `render-media`
 * bucket with the person's own session. Checks the file is in this conversation's folder, is theirs,
 * has the declared size and really is a video. Video files are never sent to an AI provider.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/videos">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id: conversationId } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });
  const { path, size, media } = parsed.data;
  const ext = videoExtensionOf(path);
  const objectName = path.slice(conversationId.length + 1);
  if (!ext || !path.startsWith(`${conversationId}/`) || !/^[0-9a-f-]{36}\.(mp4|mov|webm)$/i.test(objectName)) {
    return Response.json({ error: "validation" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: conversation } = await supabase.from("conversations").select("id, company_id").eq("id", conversationId).maybeSingle();
  if (!conversation || conversation.company_id !== member.active.companyId) return Response.json({ error: "not_found" }, { status: 404 });

  const { data: listed } = await supabase.storage.from("render-media").list(conversationId, { search: objectName, limit: 1 });
  const object = listed?.find((o) => o.name === objectName);
  const remove = () => supabase.storage.from("render-media").remove([path]);
  if (!object || Number(object.metadata?.size) !== size) {
    await remove();
    return Response.json({ error: "upload_failed" }, { status: 400 });
  }
  const { data: signed } = await supabase.storage.from("render-media").createSignedUrl(path, 60);
  const head = signed?.signedUrl
    ? new Uint8Array(await (await fetch(signed.signedUrl, { headers: { Range: "bytes=0-15" } })).arrayBuffer().catch(() => new ArrayBuffer(0)))
    : new Uint8Array();
  if (!videoContentMatches(head, ext)) {
    await remove();
    return Response.json({ error: "attachment_type" }, { status: 415 });
  }

  const filename = parsed.data.filename.replace(/[\u0000-\u001f]/g, "").slice(0, 255);
  const { data, error } = await supabase
    .from("conversation_attachments")
    .insert({
      conversation_id: conversationId,
      filename,
      mime_type: VIDEO_TYPES[ext].mime,
      size_bytes: size,
      storage_path: path,
      kind: "video",
      bucket: "render-media",
      media,
      text_truncated: false,
    })
    .select("id, filename, kind")
    .single();
  if (error || !data) {
    await remove();
    return Response.json({ error: "upload_failed" }, { status: 500 });
  }
  return Response.json({ id: data.id, filename: data.filename, kind: data.kind, truncated: false });
}
