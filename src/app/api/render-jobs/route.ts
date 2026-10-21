import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { RenderJobsResponse, RenderJobView } from "@/modules/render/types";

/** The renders of one AI answer, for the people who can see it (RLS), with the video credits left. Metadata only. */
export async function GET(request: Request) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const message = z.uuid().safeParse(new URL(request.url).searchParams.get("message"));
  if (!message.success) return Response.json({ error: "validation" }, { status: 400 });
  const supabase = await createClient();
  const { data } = await supabase
    .from("render_jobs")
    .select("id, kind, status, progress, stage, formats, duration_seconds, outputs, error_code, credits_reserved, credits_charged, created_by, created_at")
    .eq("message_id", message.data)
    .order("created_at", { ascending: false })
    .limit(10);
  const jobs: RenderJobView[] = (data ?? []).map((j) => ({
    id: j.id,
    kind: j.kind as RenderJobView["kind"],
    status: j.status as RenderJobView["status"],
    progress: Number(j.progress),
    stage: j.stage,
    formats: j.formats as RenderJobView["formats"],
    durationSeconds: Number(j.duration_seconds),
    outputs: ((j.outputs as RenderJobView["outputs"] | null) ?? []).map((o) => ({
      format: o.format,
      width: o.width,
      height: o.height,
      seconds: o.seconds,
      bytes: o.bytes,
    })),
    errorCode: j.error_code,
    creditsReserved: Number(j.credits_reserved),
    creditsCharged: j.credits_charged === null ? null : Number(j.credits_charged),
    mine: j.created_by === member.user.id,
    createdAt: j.created_at,
  }));
  // What the render button needs: the rates set by our team and the company's video credits this month.
  const [{ data: rates }, { data: credits }] = await Promise.all([
    supabase.from("render_rates").select("kind, credits_per_second"),
    supabase.rpc("my_video_credits", { p_company: member.active.companyId }),
  ]);
  const quota = credits?.[0];
  return Response.json(
    {
      jobs,
      rates: Object.fromEntries((rates ?? []).map((r) => [r.kind, Number(r.credits_per_second)])),
      creditsLeft: quota ? Math.max(0, Number(quota.video_limit) - Number(quota.video_used) - Number(quota.video_reserved)) : 0,
      creditsLimit: quota ? Number(quota.video_limit) : 0,
    } satisfies RenderJobsResponse,
    { headers: { "Cache-Control": "no-store" } },
  );
}
