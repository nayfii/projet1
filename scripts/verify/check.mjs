// Version check (verify.yml, or locally): signs in as the demo boss and the demo employee of our
// fictional company, opens each screen, records errors and a capture, and stores the result for our
// console (Platform → Aperçu). Never signs in as anyone else; never reads a customer's space.
// Env: APP_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY, optional GITHUB_RUN_ID.
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
if (!APP_URL || !SUPABASE_URL || !SERVICE_KEY) {
  console.error("APP_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  process.exit(2);
}

const DEMO = {
  owner: { email: "verification-gerant@example.com", name: "Gérant démo" },
  member: { email: "verification-employe@example.com", name: "Employée démo" },
};
// Screens per role. "deny": the screen must send this person elsewhere (an employee has no admin).
const SCREENS = {
  owner: [
    { screen: "home", path: "/" },
    { screen: "chat", path: "/chat" },
    { screen: "clients", path: "/clients" },
    { screen: "memory", path: "/memory" },
    { screen: "admin", path: "/admin" },
    { screen: "members", path: "/admin/members" },
    { screen: "usage", path: "/admin/usage" },
  ],
  member: [
    { screen: "home", path: "/" },
    { screen: "chat", path: "/chat" },
    { screen: "clients", path: "/clients" },
    { screen: "profile", path: "/profile" },
    { screen: "admin_denied", path: "/admin", deny: true },
  ],
};
const ERROR_TEXT = /Un problème est survenu|Something went wrong|Application error|Page introuvable|Page not found/i;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser({ email, name }) {
  const created = await supabase.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
  if (created.data?.user) return created.data.user.id;
  const link = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.user) throw new Error(`demo user ${email}: ${created.error?.message ?? link.error?.message}`);
  return link.data.user.id;
}

async function signInLink(email) {
  const { data, error } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`sign-in link for ${email}: ${error?.message ?? "no token"}`);
  const url = new URL("/auth/confirm", APP_URL);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", "/");
  return url.toString();
}

const started = new Date();
const runKey = process.env.GITHUB_RUN_ID ? `run-${process.env.GITHUB_RUN_ID}` : `local-${started.getTime()}`;
const live = await fetch(`${APP_URL}/api/version`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));

const ownerId = await ensureUser(DEMO.owner);
const memberId = await ensureUser(DEMO.member);
const seeded = await supabase.rpc("platform_seed_demo_company", { p_owner: ownerId, p_member: memberId });
if (seeded.error) throw new Error(`demo company: ${seeded.error.message}`);

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const results = [];
for (const role of ["owner", "member"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "fr-FR" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  try {
    await page.goto(await signInLink(DEMO[role].email), { waitUntil: "networkidle", timeout: 60_000 });
    if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("sign-in refused");
  } catch (error) {
    for (const s of SCREENS[role]) results.push({ role, screen: s.screen, path: s.path, ok: false, error: `Connexion impossible : ${error.message}`.slice(0, 300), image: null });
    await context.close();
    continue;
  }
  for (const { screen, path, deny } of SCREENS[role]) {
    pageErrors.length = 0;
    let ok = true;
    let error = null;
    try {
      const response = await page.goto(`${APP_URL}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
      const landed = new URL(page.url()).pathname;
      if (deny) {
        if (landed.startsWith(path)) [ok, error] = [false, "L'employée a ouvert l'administration."];
      } else if (!response || response.status() >= 400) {
        [ok, error] = [false, `Réponse ${response?.status() ?? "absente"}`];
      } else if (landed.startsWith("/login")) {
        [ok, error] = [false, "Renvoyé vers la connexion."];
      } else if (await page.getByText(ERROR_TEXT).count()) {
        [ok, error] = [false, "La page affiche une erreur."];
      }
      if (ok && pageErrors.length) [ok, error] = [false, `Erreur dans la page : ${pageErrors[0]}`];
    } catch (e) {
      [ok, error] = [false, `Pas de réponse : ${String(e.message).split("\n")[0].slice(0, 160)}`];
    }
    let image = null;
    try {
      const shot = await page.screenshot({ type: "jpeg", quality: 70 });
      const target = `${runKey}/${role}-${screen}.jpg`;
      const upload = await supabase.storage.from("platform-checks").upload(target, shot, { contentType: "image/jpeg", upsert: true });
      if (!upload.error) image = target;
    } catch {
      // A missing capture does not hide the result.
    }
    results.push({ role, screen, path, ok, error, image });
    console.log(`${ok ? "OK  " : "FAIL"} ${role.padEnd(6)} ${path}${error ? ` — ${error}` : ""}`);
  }
  await context.close();
}
await browser.close();

const status = results.every((r) => r.ok) ? "passed" : "failed";
const insert = await supabase.from("platform_check_runs").insert({
  github_run_id: process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null,
  version: typeof live.version === "string" ? live.version.slice(0, 40) : null,
  commit_sha: typeof live.commit === "string" ? live.commit.slice(0, 64) : null,
  status,
  results,
  started_at: started.toISOString(),
  finished_at: new Date().toISOString(),
});
if (insert.error) throw new Error(`saving the result: ${insert.error.message}`);
console.log(`Version ${live.version ?? "?"}: ${status} (${results.filter((r) => r.ok).length}/${results.length} screens).`);
process.exit(status === "passed" ? 0 : 1);
