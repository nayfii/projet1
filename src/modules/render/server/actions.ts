"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { logBlockedRequest } from "@/modules/usage/server/record";
import { extractComposition, inspectComposition } from "../composition";
import { extractEditPlan, planClips, planDuration } from "../edit-plan";
import { FORMAT_KEYS, type VideoFormat } from "../formats";

/**
 * Asks the worker to make a video from an AI answer: the composition (Motion Design) or the edit plan
 * (Video Editor) is read from the answer on our server, with the person's session, and every file it
 * names must be an attachment of this conversation. `enqueue_render_job` checks access, the agent and
 * the video credits again in the database.
 */
export async function requestRenderAction(input: { messageId: string; formats?: VideoFormat[] }): Promise<ActionResult<{ jobId: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ messageId: z.uuid(), formats: z.array(z.enum(FORMAT_KEYS as [VideoFormat, ...VideoFormat[]])).min(1).max(3).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select("id, conversation_id, content, author_type, status, conversation:conversations(agent:agents!conversations_agent_id_fkey(builtin_key))")
    .eq("id", parsed.data.messageId)
    .maybeSingle();
  if (!message || message.author_type !== "assistant") return { ok: false, error: "not_found" };
  const agentKey = message.conversation?.agent?.builtin_key;
  const kind = agentKey === "motion_design" ? "motion" : agentKey === "video_editor" ? "video_edit" : null;
  if (!kind) return { ok: false, error: "forbidden" };

  const { data: attachments } = await supabase
    .from("conversation_attachments")
    .select("id, filename, kind, message_id, created_at")
    .eq("conversation_id", message.conversation_id)
    .not("message_id", "is", null)
    .order("created_at", { ascending: false });
  // The latest file with that name wins when a name was used twice.
  const byName = (name: string, kinds: string[]) => (attachments ?? []).find((a) => a.filename === name && kinds.includes(a.kind));

  let formats: VideoFormat[];
  let duration: number;
  let rpcInput: Record<string, unknown>;
  if (kind === "motion") {
    const html = extractComposition(message.content);
    const inspected = html ? inspectComposition(html) : null;
    if (!html || !inspected?.ok) return { ok: false, error: "render_invalid" };
    const assets = inspected.info.assets.map((name) => ({ name, file: byName(name, ["image"]) }));
    if (assets.some((a) => !a.file)) return { ok: false, error: "render_missing_file" };
    formats = [inspected.info.format];
    duration = inspected.info.duration;
    rpcInput = { composition: html, assets: assets.map((a) => ({ attachment_id: a.file!.id, name: a.name })) };
  } else {
    const extracted = extractEditPlan(message.content);
    if (!extracted.ok) return { ok: false, error: "render_invalid" };
    const plan = extracted.plan;
    const clips = planClips(plan).map((name) => ({ name, file: byName(name, ["video"]) }));
    if (clips.some((c) => !c.file)) return { ok: false, error: "render_missing_file" };
    formats = parsed.data.formats ?? plan.formats;
    duration = planDuration(plan);
    rpcInput = { plan, assets: clips.map((c) => ({ attachment_id: c.file!.id, name: c.name })) };
  }

  const { data: jobId, error } = await supabase.rpc("enqueue_render_job", {
    p_message: message.id,
    p_kind: kind,
    p_formats: formats,
    p_duration: duration,
    p_input: rpcInput as never,
  });
  if (error || !jobId) {
    const code = toErrorCode(error);
    if (code === "video_quota_exceeded") await logBlockedRequest(ctx.active.companyId, ctx.user.id, "quota_video");
    return { ok: false, error: code };
  }
  return { ok: true, data: { jobId } };
}

export async function cancelRenderAction(input: { jobId: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ jobId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("cancel_render_job", { p_job: parsed.data.jobId });
  return error ? { ok: false, error: toErrorCode(error) } : { ok: true };
}
