import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { shot, signIn } from "./helpers";

/**
 * Our console's versions, preview and debug pages (CLAUDE.md §11), locally: GitHub is not connected
 * here, so launching and Claude Code show what to set up; the version check itself runs for real
 * against this server (demo boss and demo employee of the fictional company).
 */
test.describe.configure({ mode: "serial" });

const version = `v${JSON.parse(readFileSync("release.json", "utf8")).version}`;

function localEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

test("Versions: the live version, what the next launch needs, and the history", async ({ page }) => {
  await signIn(page, "platform@demo.local");
  await page.goto("/platform/releases");
  await expect(page.getByRole("heading", { name: "Versions", exact: true })).toBeVisible();
  await expect(page.getByTestId("live-version")).toHaveText(version);
  await expect(page.getByTestId("github-setup")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Lancer la v/ })).toBeDisabled();
  await shot(page, "rel-01-versions");

  // The version is written in the account menu, in our console as in the customers' app.
  await page.getByRole("button", { name: /platform@demo\.local/ }).click();
  await expect(page.getByTestId("app-version")).toHaveText(`Version ${version}`);
  await page.keyboard.press("Escape");
});

test("Preview: the live version checked as a demo boss and a demo employee", async ({ page }) => {
  const env = localEnv();
  execFileSync("node", ["scripts/verify/check.mjs"], {
    env: {
      ...process.env,
      APP_URL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
      SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_KEY: env.SUPABASE_SECRET_KEY,
    },
    stdio: "pipe",
    timeout: 240_000,
  });
  await signIn(page, "platform@demo.local");
  await page.goto("/platform/preview");
  await expect(page.getByText("Tout est bon").first()).toBeVisible();
  await expect(page.getByText(`Version vérifiée : ${version}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vue du gérant" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vue d'une employée" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Accueil — Vue du gérant" })).toBeVisible();
  await expect(page.getByText("Administration refusée")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vérifier maintenant" })).toBeDisabled();
  await shot(page, "rel-02-preview");
});

test("Debug: Claude Code waits for GitHub to be connected; no dead button", async ({ page }) => {
  await signIn(page, "platform@demo.local");
  await page.goto("/platform/debug");
  await expect(page.getByRole("heading", { name: "Debug avec Claude Code" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Problème ou modification à faire" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Envoyer à Claude Code" })).toBeDisabled();
  await expect(page.getByText("jamais les données de vos clients")).toBeVisible();
  await shot(page, "rel-03-debug");
});

test("Customers see the version too, and a demo company never shows up as a customer's space", async ({ page }) => {
  await signIn(page, "verification-employe@example.com");
  await page.getByRole("button", { name: /Employée démo/ }).click();
  await expect(page.getByTestId("app-version")).toHaveText(`Version ${version}`);
});
