import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

/** Downloads a memory document: RLS decides whether the row is visible, then a 60-second signed link. */
export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("storage_path, filename").eq("id", id).maybeSingle();
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  const { data: signed } = await supabase.storage.from("memory-documents").createSignedUrl(data.storage_path, 60, { download: data.filename });
  if (!signed?.signedUrl) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.redirect(signed.signedUrl, 302);
}
