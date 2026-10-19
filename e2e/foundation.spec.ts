import { test, expect } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { shot, signIn } from "./helpers";

/**
 * Step 1 foundation, as a real user would do it: sign-up by magic link, onboarding, invitations,
 * a restricted client, member restrictions, and the platform console.
 */
const run = Date.now().toString(36);
const owner = `owner-${run}@demo.local`;
const olivier = `olivier-${run}@demo.local`;
const nathalie = `nathalie-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

test("owner signs up and completes onboarding", async ({ page }) => {
  await page.goto("/login");
  await shot(page, "01-login");
  await signIn(page, owner);

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Atelier Martin ${run}`);
  await shot(page, "02-onboarding-start");
  await page.getByRole("button", { name: "Créer l'espace" }).click();

  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await page.getByLabel("Secteur d'activité").fill("Agence de communication");
  await shot(page, "03-onboarding-company");
  await page.getByRole("button", { name: "Continuer" }).click();

  await expect(page.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await page.getByLabel("Adresses e-mail").fill(`${olivier}, ${nathalie}`);
  await page.getByRole("button", { name: "Envoyer les invitations" }).click();
  await expect(page.getByText(olivier)).toBeVisible();
  await expect(page.getByText("E-mail envoyé")).toHaveCount(2);
  await shot(page, "04-onboarding-invite");
  await page.getByRole("button", { name: "Continuer" }).click();

  await expect(page.getByRole("heading", { name: "Ajoutez un premier client" })).toBeVisible();
  await page.getByLabel("Nom du client").fill("Client A");
  await page.getByRole("button", { name: /Restreint/ }).click();
  await shot(page, "05-onboarding-client");
  await page.getByRole("button", { name: "Créer le client" }).click();

  await expect(page.getByRole("heading", { name: "Votre premier document" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un document" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Votre première conversation" })).toBeVisible();
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();

  await expect(page.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();
  await shot(page, "06-home-owner");
});

test("invited colleagues join from their email", async ({ browser }) => {
  for (const [email, name, expertise] of [
    [olivier, "Olivier Durand", "commercial"],
    [nathalie, "Nathalie Petit", "finance"],
  ]) {
    const page = await (await browser.newContext()).newPage();
    const link = await latestLinkFor(email, new Date(0));
    expect(link).toContain("type=invite");
    await page.goto(link);
    await expect(page.getByRole("button", { name: "Accepter l'invitation" })).toBeVisible();
    await page.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(page.getByRole("heading", { name: /Bienvenue chez/ })).toBeVisible();
    await page.getByLabel("Votre nom").fill(name);
    await page.getByLabel("Domaines d'expertise").fill(expertise);
    if (email === nathalie) await shot(page, "07-member-welcome");
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByRole("heading", { name: `Bonjour ${name.split(" ")[0]}` })).toBeVisible();
    await page.context().close();
  }
});

test("owner restricts Client A to Olivier; Nathalie cannot see it", async ({ browser }) => {
  const ownerPage = await (await browser.newContext()).newPage();
  await signIn(ownerPage, owner);
  await ownerPage.goto("/admin/members");
  await expect(ownerPage.getByText("Nathalie Petit")).toBeVisible();
  await expect(ownerPage.getByText("finance")).toBeVisible();
  await shot(ownerPage, "08-admin-members");

  await ownerPage.goto("/admin/clients");
  await ownerPage.getByRole("button", { name: /Personne n'a accès/ }).click();
  await ownerPage.getByRole("checkbox").first().waitFor();
  await ownerPage.getByText("Olivier Durand").click();
  await expect(ownerPage.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await shot(ownerPage, "09-admin-client-access");
  await ownerPage.getByRole("button", { name: "Terminé" }).click();
  await ownerPage.reload();
  await expect(ownerPage.getByRole("button", { name: /1 personne a accès/ })).toBeVisible();
  await shot(ownerPage, "10-admin-clients");

  await ownerPage.goto("/admin/activity");
  await expect(ownerPage.getByText("a donné accès à Client A à Olivier Durand")).toBeVisible();
  await shot(ownerPage, "11-admin-activity");

  const nathaliePage = await (await browser.newContext()).newPage();
  await signIn(nathaliePage, nathalie);
  await nathaliePage.goto("/clients");
  await expect(nathaliePage.getByText("Aucun client ne vous a encore été attribué.")).toBeVisible();
  const clientUrl = ownerPage.url().replace("/admin/clients", "/clients");
  void clientUrl;
  await nathaliePage.goto("/admin");
  await expect(nathaliePage).toHaveURL(/\/$/);
  await shot(nathaliePage, "12-member-clients-empty");

  const olivierPage = await (await browser.newContext()).newPage();
  await signIn(olivierPage, olivier);
  await olivierPage.goto("/clients");
  await expect(olivierPage.getByText("Client A")).toBeVisible();
  await olivierPage.getByText("Client A").click();
  await expect(olivierPage.getByRole("heading", { name: "Client A" })).toBeVisible();
  const directUrl = olivierPage.url();
  await shot(olivierPage, "13-member-client-page");

  // Nathalie opens the exact URL of Client A: 404, the client's existence is not revealed.
  await nathaliePage.goto(directUrl);
  await expect(nathaliePage.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
});

test("platform admin sees companies but no content", async ({ page }) => {
  await signIn(page, "platform@demo.local");
  await page.goto("/platform");
  await expect(page.getByText(`Atelier Martin ${run}`)).toBeVisible();
  await expect(page.getByText(owner)).toBeVisible();
  await shot(page, "14-platform-companies");
  await page.goto("/platform/plans");
  await expect(page.getByText("Démo / Demo")).toBeVisible();
  await shot(page, "15-platform-plans");
  // The platform admin has no company: the member app sends them back to the platform console.
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/platform$/);
});

test("works on a phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
  const page = await context.newPage();
  await signIn(page, owner);
  await expect(page.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();
  await shot(page, "16-mobile-home");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await shot(page, "17-mobile-menu");
  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/admin/members");
  await shot(page, "18-mobile-admin-members");
  await context.close();
});
