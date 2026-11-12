import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WfGraph } from "../graph";

/**
 * Changes only our server makes (the person's right to edit is checked first, with their session):
 * versions at activation, status, scheduling, cancelling waiting runs, the webhook secret, the log.
 */

export async function createVersion(workflowId: string, companyId: string, userId: string, graph: WfGraph): Promise<string> {
  const admin = createAdminClient();
  const { data: last } = await admin.from("workflow_versions").select("version").eq("workflow_id", workflowId).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await admin
    .from("workflow_versions")
    .insert({ workflow_id: workflowId, company_id: companyId, version: (last?.version ?? 0) + 1, graph: graph as never, created_by: userId })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("version failed");
  return data.id;
}

export async function setActive(workflowId: string, versionId: string, nextRunAt: string | null) {
  await createAdminClient().from("workflows").update({ status: "active", active_version_id: versionId, next_run_at: nextRunAt, trigger_state: {} }).eq("id", workflowId);
}

/** Pause: no new automatic run; queued and waiting runs are cancelled (an action already done stays done). */
export async function setPaused(workflowId: string): Promise<number> {
  const admin = createAdminClient();
  await admin.from("workflows").update({ status: "paused", next_run_at: null }).eq("id", workflowId);
  const { data } = await admin
    .from("workflow_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString(), error_code: "paused", lease_until: null })
    .eq("workflow_id", workflowId)
    .eq("mode", "live")
    .in("status", ["queued", "waiting"])
    .select("id");
  return data?.length ?? 0;
}

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** A new webhook secret: only its hash is kept; the secret is shown once. */
export async function rotateWebhookSecret(workflowId: string): Promise<string> {
  const secret = `whs_${randomBytes(24).toString("base64url")}`;
  await createAdminClient().from("workflows").update({ webhook_secret_hash: hashSecret(secret) }).eq("id", workflowId);
  return secret;
}

export async function webhookTarget(workflowId: string, secret: string) {
  const { data } = await createAdminClient().from("workflows").select("id, company_id, status, active_version_id, webhook_secret_hash").eq("id", workflowId).maybeSingle();
  if (!data?.webhook_secret_hash || !secret) return null;
  const a = Buffer.from(data.webhook_secret_hash, "hex");
  const b = Buffer.from(hashSecret(secret), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return data;
}

export async function recentRunCount(workflowId: string, sinceMs: number): Promise<number> {
  const { count } = await createAdminClient().from("workflow_runs").select("id", { count: "exact", head: true }).eq("workflow_id", workflowId).gte("created_at", new Date(Date.now() - sinceMs).toISOString());
  return count ?? 0;
}

export async function logWorkflow(companyId: string, actorId: string | null, action: "workflow.activated" | "workflow.paused" | "workflow.deleted" | "workflow.webhook_secret", workflowId: string, metadata: Record<string, string | number | boolean | string[] | null> = {}) {
  await createAdminClient().from("audit_log").insert({ scope: "company", company_id: companyId, actor_id: actorId, action, target_type: "workflow", target_id: workflowId, metadata });
}

/** The trigger type of a version (the webhook route checks it is a webhook trigger). */
export async function versionTriggerType(versionId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("workflow_versions").select("graph").eq("id", versionId).maybeSingle();
  const nodes = ((data?.graph ?? {}) as { nodes?: { type?: string }[] }).nodes ?? [];
  return nodes.find((n) => typeof n.type === "string" && n.type.startsWith("trigger."))?.type ?? null;
}
