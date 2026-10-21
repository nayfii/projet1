import { execSync } from "node:child_process";

/**
 * Integration tests run against the local Supabase stack (`pnpm db:start`).
 * Connection details are read from `supabase status` so no secret is hardcoded.
 */
export default function setup() {
  let status: Record<string, string>;
  try {
    status = JSON.parse(execSync("supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString());
  } catch {
    throw new Error("Local Supabase is not running. Start it with `pnpm db:start`.");
  }
  process.env.TEST_SUPABASE_URL = status.API_URL;
  process.env.TEST_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.TEST_SUPABASE_SECRET_KEY = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  process.env.TEST_DATABASE_URL = status.DB_URL;
  // Server modules under test (e.g. the built-in agents sync) read the app's own variables.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= status.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_SECRET_KEY ??= process.env.TEST_SUPABASE_SECRET_KEY;
}
