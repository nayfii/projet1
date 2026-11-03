import { execSync } from "node:child_process";
import pg from "pg";

/**
 * The specs sign up owners who create their own company: sign-up is opened in the local database
 * (in production it is by our team's invitation only, CLAUDE.md §11).
 */
export default async function setup() {
  const status = JSON.parse(execSync("supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString()) as { DB_URL: string };
  const db = new pg.Client({ connectionString: status.DB_URL });
  await db.connect();
  try {
    // The render worker runs next to the local stack: the video apps are open (they are "Coming soon"
    // in production until it is hosted).
    await db.query("update public.platform_settings set open_signup = true, video_apps_enabled = true where id");
  } finally {
    await db.end();
  }
}
