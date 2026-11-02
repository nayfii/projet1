"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { toErrorCode } from "@/lib/errors";
import { APP_VERSION, nextVersion } from "@/lib/version";
import { closePull, dispatchWorkflow, mergePull, pullForBranch, type GitHubError } from "./github";

/**
 * Our console (CLAUDE.md §11): launch a version, check the live one, ask Claude Code for a change and
 * accept or refuse it. Platform admins only; each step is in the platform audit log (no text).
 */
export type ReleaseActionError = GitHubError | "forbidden" | "validation" | "unknown";

async function log(action: "release.launched" | "check.requested" | "fix.accepted" | "fix.rejected", target: string, version: string | null) {
  await (await createClient()).rpc("platform_log_release_event", { p_action: action, p_target: target, p_version: version as string });
}

export async function launchReleaseAction(input: { notes: string }): Promise<{ ok: true; version: string } | { ok: false; error: ReleaseActionError }> {
  const admin = await platformAdminOrNull();
  if (!admin) return { ok: false, error: "forbidden" };
  const parsed = z.object({ notes: z.string().trim().max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const version = `v${nextVersion(APP_VERSION)}`;
  const result = await dispatchWorkflow("release.yml", { notes: parsed.data.notes, requested_by: admin.profile.fullName ?? "" });
  if (!result.ok) return result;
  await log("release.launched", "next", version);
  revalidatePath("/platform/releases");
  return { ok: true, version };
}

export async function runCheckAction(): Promise<{ ok: true } | { ok: false; error: ReleaseActionError }> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const result = await dispatchWorkflow("verify.yml", { expect_version: "" });
  if (!result.ok) return result;
  await log("check.requested", "live", APP_VERSION);
  revalidatePath("/platform/preview");
  return { ok: true };
}

/** A change asked of Claude Code: saved, then sent to the workflow that prepares it as a pull request. */
export async function createFixRequestAction(input: { request: string }): Promise<{ ok: true; id: string } | { ok: false; error: ReleaseActionError }> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  const parsed = z.object({ request: z.string().trim().min(5).max(4000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("platform_create_fix_request", { p_request: parsed.data.request });
  if (error || !id) return { ok: false, error: toErrorCode(error) === "forbidden" ? "forbidden" : "unknown" };
  const sent = await dispatchWorkflow("claude-fix.yml", { request_id: id, request: parsed.data.request });
  revalidatePath("/platform/debug");
  if (!sent.ok) return sent;
  return { ok: true, id };
}

async function decide(requestId: string, accept: boolean): Promise<{ ok: true } | { ok: false; error: ReleaseActionError }> {
  if (!(await platformAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(requestId).success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const { data: request } = await supabase.from("platform_fix_requests").select("id, request").eq("id", requestId).maybeSingle();
  if (!request) return { ok: false, error: "not_found" };
  const pr = await pullForBranch(`claude-fix/${requestId}`);
  if (!pr.ok) return pr;
  if (!pr.data || pr.data.state !== "open") return { ok: false, error: "conflict" };
  const result = accept
    ? await mergePull(pr.data.number, `Claude Code: ${request.request.split("\n")[0].slice(0, 100)}`)
    : await closePull(pr.data.number);
  if (!result.ok) return result;
  await log(accept ? "fix.accepted" : "fix.rejected", requestId, null);
  revalidatePath("/platform/debug");
  revalidatePath("/platform/releases");
  return { ok: true };
}

/** Accepted: the change joins the development branch and leaves with the next launched version. */
export async function acceptFixAction(input: { requestId: string }) {
  return decide(input.requestId, true);
}

export async function rejectFixAction(input: { requestId: string }) {
  return decide(input.requestId, false);
}
