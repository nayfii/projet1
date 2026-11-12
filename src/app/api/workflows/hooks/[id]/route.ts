import { after } from "next/server";
import { logEvent } from "@/lib/log";
import { recentRunCount, versionTriggerType, webhookTarget } from "@/modules/workflows/server/control";
import { enqueueRun, executeRun } from "@/modules/workflows/server/engine";

export const maxDuration = 300;

/**
 * Authenticated webhook trigger: POST JSON with `Authorization: Bearer <secret>` (shown once in the
 * editor). Only an active workflow whose active version starts with a webhook trigger accepts it;
 * `Idempotency-Key` prevents duplicates; 60 calls per hour at most.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/workflows/hooks/[id]">) {
  const { id } = await ctx.params;
  const secret = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const target = /^[0-9a-f-]{36}$/.test(id) ? await webhookTarget(id, secret) : null;
  if (!target) {
    logEvent("warn", "webhook.refused", { workflow: /^[0-9a-f-]{36}$/.test(id) ? id : null, code: "forbidden" });
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (target.status !== "active" || !target.active_version_id) return Response.json({ error: "paused" }, { status: 409 });
  if ((await versionTriggerType(target.active_version_id)) !== "trigger.webhook") return Response.json({ error: "not_webhook" }, { status: 409 });
  if ((await recentRunCount(id, 3_600_000)) >= 60) return Response.json({ error: "rate_limited" }, { status: 429 });
  const raw = await request.text();
  if (raw.length > 100_000) return Response.json({ error: "too_large" }, { status: 413 });
  let payload: Record<string, unknown> = {};
  try {
    const json = raw ? JSON.parse(raw) : {};
    payload = json && typeof json === "object" && !Array.isArray(json) ? json : { value: json };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const key = request.headers.get("idempotency-key")?.slice(0, 150) ?? null;
  const run = await enqueueRun({ workflowId: id, companyId: target.company_id, mode: "live", trigger: "webhook", triggeredBy: null, input: payload, idempotencyKey: key ? `webhook:${key}` : null, versionId: target.active_version_id });
  if (!run.duplicate) after(() => executeRun(run.id));
  return Response.json({ run: run.id, duplicate: run.duplicate }, { status: 202 });
}
