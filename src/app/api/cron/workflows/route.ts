import { logEvent } from "@/lib/log";
import { tick } from "@/modules/workflows/server/engine";
import { recordHeartbeat } from "@/modules/platform/server/operations";

export const maxDuration = 300;

/**
 * The workflows' clock (every 5 minutes from .github/workflows/workflows-tick.yml; daily from vercel.json): schedules that are due, new e-mails
 * for e-mail triggers, runs that waited long enough and runs an interrupted executor left behind.
 * Only our clock may call it: it sends `Authorization: Bearer <CRON_SECRET>`. Each run is recorded (counts only).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    logEvent("warn", "cron.refused", { configured: Boolean(secret) });
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const started = performance.now();
  const result = await tick();
  const ms = performance.now() - started;
  // Our console shows when the clock last ran (a clock that never runs leaves schedules waiting).
  await recordHeartbeat("workflows.tick", { ...result, ms: Math.round(ms) }).catch(() => logEvent("error", "cron.heartbeat_failed"));
  logEvent("info", "cron.tick", { ...result, ms });
  return Response.json(result);
}
