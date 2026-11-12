import { pingDatabase } from "@/modules/platform/server/operations";
import { logEvent } from "@/lib/log";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Up or not, for uptime checks (.github/workflows/uptime.yml): the site answers and the database
 * answers within 3 seconds. Public and without any data: the version, and how long the database took.
 */
export async function GET() {
  const started = performance.now();
  const database = await pingDatabase(3_000);
  const ms = Math.round(performance.now() - started);
  if (!database) logEvent("error", "health.database_down", { ms });
  return Response.json(
    { status: database ? "ok" : "down", version: APP_VERSION, checks: { database: { ok: database, ms } } },
    { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
