/**
 * Adapts supabase/config.toml for the hosted project before `supabase config push` (GitHub Actions only;
 * the file is changed in the runner, never committed). Local values stay the source of truth for
 * everything else: email templates, sign-up rules, storage limit.
 *
 * Reads: APP_URL (the app's public address), and optionally SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_SENDER_EMAIL,
 * SMTP_SENDER_NAME (the password stays in the SMTP_PASSWORD environment variable, read by the Supabase CLI).
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = "supabase/config.toml";
const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(appUrl)) {
  console.error("APP_URL must be the app's https address, for example https://my-app.vercel.app");
  process.exit(1);
}

let config = readFileSync(file, "utf8");
const set = (pattern, line) => {
  if (!pattern.test(config)) throw new Error(`Setting not found in ${file}: ${pattern}`);
  config = config.replace(pattern, line);
};

set(/^site_url = .*$/m, `site_url = "${appUrl}"`);
set(/^additional_redirect_urls = .*$/m, `additional_redirect_urls = ["${appUrl}/**"]`);
// One sign-in link per address per minute (locally: one per second, for the tests).
set(/^max_frequency = "1s"$/m, `max_frequency = "60s"`);

const smtp = {
  host: process.env.SMTP_HOST?.trim(),
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER?.trim(),
  senderEmail: process.env.SMTP_SENDER_EMAIL?.trim(),
  senderName: process.env.SMTP_SENDER_NAME?.trim() || "Workspace",
};
if (smtp.host && smtp.user && smtp.senderEmail && process.env.SMTP_PASSWORD) {
  // With our own mail server, more than Supabase's 2 test emails per hour can go out.
  set(/^email_sent = 2$/m, "email_sent = 60");
  config += `
[auth.email.smtp]
enabled = true
host = "${smtp.host}"
port = ${smtp.port}
user = "${smtp.user}"
pass = "env(SMTP_PASSWORD)"
admin_email = "${smtp.senderEmail}"
sender_name = "${smtp.senderName.replace(/"/g, "")}"
`;
  console.log(`Emails: sent through ${smtp.host}.`);
} else {
  // Supabase refuses custom email templates on its free plan without our own mail server: keep its
  // default emails (their links work through /auth/callback, in the browser that asked for them).
  config = config.replace(/^\[auth\.email\.template\.[a-z_]+\]\n(?:[a-z_]+ = .*\n)*/gm, "");
  console.log("Emails: Supabase's test mailer and default templates (2 emails per hour, to the project's team members only). Add the SMTP settings to lift it.");
}

writeFileSync(file, config);
console.log(`Sign-in links point to ${appUrl}.`);
