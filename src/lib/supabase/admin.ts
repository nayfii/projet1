import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Service-role client: BYPASSES Row Level Security.
 * Only for the few audited server modules listed in docs/ARCHITECTURE.md §5
 * (auth emails and invitations, platform bootstrap, and later Hide vault, usage, render worker).
 * Never use it to read customer content on behalf of a user.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
