import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Our own operations, outside any company: is the database answering, when did our clock last run.
 * Service role (audited module): no customer data is read or written here.
 */

/** The database answers within `timeoutMs`. */
export async function pingDatabase(timeoutMs = 3_000): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from("platform_settings").select("id").limit(1).abortSignal(AbortSignal.timeout(timeoutMs));
    return !error;
  } catch {
    return false;
  }
}

/** A periodic job ran: its name, when, and counts only (shown in our console's health page). */
export async function recordHeartbeat(name: string, detail: Record<string, number>): Promise<void> {
  const { error } = await createAdminClient().from("platform_heartbeats").upsert({ name, at: new Date().toISOString(), detail }, { onConflict: "name" });
  // A database without the table yet (a preview before the V1.1 migration): nothing to record.
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
}
