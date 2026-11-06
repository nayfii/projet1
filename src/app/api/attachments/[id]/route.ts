import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

/** Opens an attachment: RLS decides whether the row is visible, then a short-lived signed link is issued. */
export async function GET(request: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.from("conversation_attachments").select("storage_path, filename, bucket").eq("id", id).maybeSingle();
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  // "?inline=1": shown in the page (an image in an answer); otherwise downloaded under its name.
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const { data: signed } = await supabase.storage
    .from(data.bucket)
    .createSignedUrl(data.storage_path, 60, inline ? undefined : { download: data.filename });
  if (!signed?.signedUrl) return Response.json({ error: "not_found" }, { status: 404 });
  // A short-lived link: never kept by a browser or proxy cache.
  return new Response(null, { status: 302, headers: { Location: signed.signedUrl, "Cache-Control": "no-store" } });
}
