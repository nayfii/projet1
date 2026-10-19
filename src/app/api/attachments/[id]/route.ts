import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

/** Opens an attachment: RLS decides whether the row is visible, then a short-lived signed link is issued. */
export async function GET(_request: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.from("conversation_attachments").select("storage_path, filename").eq("id", id).maybeSingle();
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  const { data: signed } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrl(data.storage_path, 60, { download: data.filename });
  if (!signed?.signedUrl) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.redirect(signed.signedUrl, 302);
}
