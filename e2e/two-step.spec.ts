import { test, expect, type Page } from "@playwright/test";
import { signIn, skipAvatarStep } from "./helpers";
import { totpCode } from "../tests/helpers/totp";

/**
 * Two-step sign-in (docs/SECURITY.md): our team sets it up at the first sign-in; anyone can turn it on in
 * their profile, and from then on a new sign-in asks for the authenticator's code before anything else.
 */
const run = Date.now().toString(36);
const owner = `two-step-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

test("our team cannot open the console before setting up two-step sign-in", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(page, "platform@demo.local"); // sets it up, or enters the code (e2e/helpers.ts)
  await page.goto("/platform");
  await expect(page.getByRole("heading", { name: /^Bonjour/ })).toBeVisible();
  await page.goto("/platform/password");
  await expect(page.getByText("Obligatoire pour notre équipe.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Désactiver" })).toHaveCount(0);
  await page.context().close();
});

test("a boss turns it on; the next sign-in asks for the code, and a wrong one is refused", async ({ browser }) => {
  let page: Page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Atelier Deux Étapes ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.goto("/profile");
  const card = page.getByRole("region", { name: "Double authentification" });
  await expect(card.getByText("Non activée")).toBeVisible();
  await card.getByRole("button", { name: "Activer" }).click();
  const secret = (await card.getByTestId("two-step-secret").textContent())!.trim();
  await card.getByLabel("Code à 6 chiffres").fill(totpCode(secret));
  await card.getByRole("button", { name: "Activer la double authentification" }).click();
  await expect(card.getByText("Activée", { exact: true })).toBeVisible();
  await page.context().close();

  // A new sign-in (another browser): the e-mail link alone opens only the code screen.
  page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  const before = new Date(Date.now() - 1000);
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(owner);
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  const { latestLinkFor } = await import("./mail");
  await page.goto(await latestLinkFor(owner, before));
  await expect(page).toHaveURL(/\/auth\/two-step$/);
  await expect(page.getByRole("heading", { name: "Code de vérification" })).toBeVisible();
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/auth\/two-step$/);

  await page.getByLabel("Code à 6 chiffres").fill(totpCode(secret) === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Code incorrect ou expiré")).toBeVisible();
  await page.getByLabel("Code à 6 chiffres").fill(totpCode(secret));
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page).not.toHaveURL(/\/auth\/two-step/);
  await page.goto("/chat");
  await expect(page.getByRole("textbox", { name: "Écrivez votre message…" })).toBeVisible();
  await page.context().close();
});
