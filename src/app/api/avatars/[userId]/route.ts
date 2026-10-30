import { getAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { fileIdOf, readAvatarFile } from "@/modules/avatars/server/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A person's avatar image. Visible to themselves and to the people they share a company with
 * (the profiles policy decides); `?pending=<file>` is the image just generated, for its owner only.
 * The URL carries the file id, so the image can be cached until it changes.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/avatars/[userId]">) {
  const app = await getAppContext();
  if (!app) return new Response(null, { status: 403 });
  const { userId } = await ctx.params;
  if (!UUID.test(userId)) return new Response(null, { status: 404 });
  const pending = new URL(request.url).searchParams.get("pending");

  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("avatar_path, avatar_pending_path").eq("id", userId).maybeSingle();
  if (!data) return new Response(null, { status: 404 });
  const path = pending
    ? userId === app.user.id && data.avatar_pending_path && fileIdOf(data.avatar_pending_path) === pending
      ? data.avatar_pending_path
      : null
    : data.avatar_path;
  if (!path) return new Response(null, { status: 404 });

  const file = await readAvatarFile(path);
  if (!file) return new Response(null, { status: 404 });
  return new Response(file, {
    headers: {
      "Content-Type": file.type || "image/webp",
      "Cache-Control": pending ? "private, no-store" : "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
