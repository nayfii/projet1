import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import pg from "pg";

/**
 * The specs sign up owners who create their own company: sign-up is opened in the local database
 * (in production it is by our team's invitation only, CLAUDE.md §11).
 */
export default async function setup() {
  rmSync("test-results/.two-step-secrets.json", { force: true });
  const status = JSON.parse(execSync("supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString()) as { DB_URL: string };
  const db = new pg.Client({ connectionString: status.DB_URL });
  await db.connect();
  try {
    // The render worker runs next to the local stack: the video apps are open (they are "Coming soon"
    // in production until it is hosted).
    await db.query("update public.platform_settings set open_signup = true, video_apps_enabled = true where id");
    // Our team's test account sets up two-step sign-in afresh in each run (e2e/helpers.ts, passTwoStep).
    await db.query("delete from auth.mfa_factors where user_id in (select id from auth.users where email = 'platform@demo.local')");
  } finally {
    await db.end();
  }
}
