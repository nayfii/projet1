import { platformAdminOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** A file attached in Scale: our team only, through a short signed link. */
export async function GET(_request: Request, ctx: RouteContext<"/api/scale/files/[id]">) {
  if (!(await platformAdminOrNull())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "validation" }, { status: 400 });
  const supabase = await createClient();
  const { data } = await supabase.from("scale_attachments").select("storage_path, label").eq("id", id).eq("kind", "file").maybeSingle();
  if (!data?.storage_path) return Response.json({ error: "not_found" }, { status: 404 });
  const { data: signed } = await supabase.storage.from("scale-files").createSignedUrl(data.storage_path, 60, { download: data.label });
  if (!signed?.signedUrl) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.redirect(signed.signedUrl, 302);
}
