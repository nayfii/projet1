import { platformAdminOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PATH = /^doc\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$/;

/** An image of a Studio document: our team only, through a short signed link. */
export async function GET(request: Request) {
  if (!(await platformAdminOrNull())) return Response.json({ error: "forbidden" }, { status: 403 });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!PATH.test(path)) return Response.json({ error: "validation" }, { status: 400 });
  const supabase = await createClient();
  const { data } = await supabase.storage.from("scale-files").createSignedUrl(path, 300);
  if (!data?.signedUrl) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "private, max-age=240" } });
}
