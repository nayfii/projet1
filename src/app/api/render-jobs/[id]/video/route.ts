import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { FORMAT_KEYS, type VideoFormat } from "@/modules/render/formats";

/**
 * Plays or downloads a rendered video: RLS decides whether the job is visible, the storage policy
 * checks it again, then a short-lived signed link is issued.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/render-jobs/[id]/video">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const format = params.get("format") as VideoFormat | null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !format || !FORMAT_KEYS.includes(format)) return Response.json({ error: "validation" }, { status: 400 });
  const supabase = await createClient();
  const { data: job } = await supabase.from("render_jobs").select("outputs, status, kind").eq("id", id).maybeSingle();
  const output = (job?.outputs as { format: string; path: string }[] | null)?.find((o) => o.format === format);
  if (!job || job.status !== "succeeded" || !output) return Response.json({ error: "not_found" }, { status: 404 });
  const name = `${job.kind === "motion" ? "motion" : "montage"}-${format.replace(":", "x")}.mp4`;
  const { data: signed } = await supabase.storage
    .from("render-outputs")
    .createSignedUrl(output.path, 300, params.get("download") ? { download: name } : undefined);
  if (!signed?.signedUrl) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.redirect(signed.signedUrl, 302);
}
