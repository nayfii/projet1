import { expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { latestLinkFor } from "./mail";
import { totpCode } from "../tests/helpers/totp";

const shots = process.env.E2E_SCREENSHOTS;

/** Full-page screenshot into $E2E_SCREENSHOTS (used for the founder's step reports). */
export async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

/** Signs in with a magic link read from the local test mailbox. */
/** E2E_THEME=light: the same screens in the light theme (screenshots for the visual check). */
export async function applyTheme(page: Page) {
  if (process.env.E2E_THEME) await page.context().addCookies([{ name: "theme", value: process.env.E2E_THEME, url: process.env.E2E_BASE_URL ?? "http://localhost:3000" }]);
}

export async function signIn(page: Page, email: string) {
  const before = new Date(Date.now() - 1000);
  await applyTheme(page);
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();
  await page.goto(await latestLinkFor(email, before));
  await passTwoStep(page, email);
}

/**
 * Two-step sign-in, like a person with an authenticator app: our team sets it up at the first sign-in
 * (the key is kept for the next ones, per address, for this run); later sign-ins enter the code.
 */
export async function passTwoStep(page: Page, email: string) {
  await page.waitForLoadState("domcontentloaded");
  if (!new URL(page.url()).pathname.startsWith("/auth/two-step")) return;
  const secrets = readSecrets();
  if (await page.getByTestId("two-step-qr").or(page.getByRole("heading", { name: "Protégez votre accès" })).first().isVisible()) {
    const secret = (await page.getByTestId("two-step-secret").textContent())!.trim();
    secrets[email] = secret;
    mkdirSync("test-results", { recursive: true });
    writeFileSync(SECRETS, JSON.stringify(secrets));
    await page.getByLabel("Code à 6 chiffres").fill(totpCode(secret));
    await page.getByRole("button", { name: "Activer la double authentification" }).click();
  } else {
    await page.getByLabel("Code à 6 chiffres").fill(totpCode(secrets[email]));
    await page.getByRole("button", { name: "Valider" }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/two-step"));
}

const SECRETS = "test-results/.two-step-secrets.json";
function readSecrets(): Record<string, string> {
  return existsSync(SECRETS) ? (JSON.parse(readFileSync(SECRETS, "utf8")) as Record<string, string>) : {};
}

/** Onboarding: the avatar step comes right after the company is created; most specs skip it. */
export async function skipAvatarStep(page: Page) {
  await expect(page.getByRole("heading", { name: "Créez votre avatar" })).toBeVisible();
  await page.getByRole("button", { name: "Plus tard" }).click();
}

/** Setup screens opened from the home page's checklist (invite, client, document): each returns home. */
export async function openSetup(page: Page, step: "invite" | "client" | "document") {
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/chat");
  await page.goto(`/onboarding?step=${step}`);
}
