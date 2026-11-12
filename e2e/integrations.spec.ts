import { test, expect } from "@playwright/test";
import { shot, signIn, skipAvatarStep } from "./helpers";

/**
 * Integrations catalogue in a real browser. The test server has no provider registered (no OAuth
 * client, no encryption key): the catalogue must say so plainly and offer nothing that cannot work.
 */
const run = Date.now().toString(36);

test("the catalogue lists the apps, what Cendr can do, its limits, and says honestly what is not set up", async ({ page }) => {
  await signIn(page, `integ-owner-${run}@demo.local`);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Lumen ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Passer" }).click();

  await page.goto("/apps");
  await page.getByRole("link", { name: "Intégrations" }).click();
  await expect(page.getByRole("heading", { name: "Intégrations", level: 1 })).toBeVisible();
  for (const name of ["Google Workspace", "Microsoft 365", "Slack", "Notion", "Canva", "HubSpot"]) {
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  }
  const google = page.getByTestId("provider-google");
  await expect(google).toContainText("Envoyer un e-mail");
  await expect(google).toContainText("vérification de sécurité de Google");
  await expect(google.getByTestId("not-ready")).toContainText("En attente de configuration par l'équipe Cendr");
  await expect(google.getByRole("button", { name: "Connecter" })).toHaveCount(0);
  await expect(page.getByTestId("provider-canva")).toContainText("ne permet pas d'écrire du contenu");
  await expect(page.getByTestId("provider-hubspot")).toContainText("Bientôt");
  await expect(page.getByText("Configuration Cendr requise")).toBeVisible();

  // The Owner switches an app off for the company, then on again.
  const slackSwitch = page.getByRole("switch", { name: "Autoriser Slack dans l'entreprise" });
  await slackSwitch.click();
  await expect(slackSwitch).not.toBeChecked();
  await slackSwitch.click();
  await expect(slackSwitch).toBeChecked();
  await shot(page, "70-integrations");

  // In a memory, documents can come from an app; with none connected, the picker says how to connect one.
  await page.goto("/memory");
  await page.getByRole("link", { name: /Mémoire de l'entreprise/ }).click();
  await page.getByRole("tab", { name: /Documents/ }).click();
  await page.getByRole("button", { name: "Depuis une application" }).click();
  await expect(page.getByText("Aucune application de documents n'est connectée pour vous")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connecter une application" })).toHaveAttribute("href", "/integrations");
});
