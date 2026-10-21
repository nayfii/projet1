import { test, expect, type Browser, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { shot, signIn } from "./helpers";

/**
 * A tour of the screens the other specs do not capture (home, clients, profile, every admin and
 * platform page, phone), for the founder's state-of-the-product check. Each page must open without
 * an error or a "page not found". Runs after the other specs (the platform admin exists by then).
 */
const run = Date.now().toString(36);
const owner = `tour-owner-${run}@demo.local`;
const member = `tour-member-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

async function visit(page: Page, path: string, name: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Un problème est survenu" })).toHaveCount(0);
  await shot(page, name);
}

let ownerPage: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  ownerPage = await (await browser.newContext({ locale: "fr-FR" })).newPage();
});

test("the owner's screens", async () => {
  await signIn(ownerPage, owner);
  await ownerPage.getByLabel("Votre nom").fill("Claire Martin");
  await ownerPage.getByLabel("Nom de l'entreprise").fill(`Atelier Démo ${run}`);
  await ownerPage.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await shot(ownerPage, "t01-onboarding-company");
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await ownerPage.getByLabel("Adresses e-mail").fill(member);
  await ownerPage.getByRole("button", { name: "Envoyer les invitations" }).click();
  await expect(ownerPage.getByText("E-mail envoyé")).toHaveCount(1);
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await ownerPage.getByLabel("Nom du client").fill("Client A");
  await ownerPage.getByRole("button", { name: /Restreint/ }).click();
  await ownerPage.getByRole("button", { name: "Créer le client" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Votre premier document" })).toBeVisible();
  await shot(ownerPage, "t02-onboarding-document");
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Votre première conversation" })).toBeVisible();
  await shot(ownerPage, "t03-onboarding-first-conversation");
  await ownerPage.getByRole("button", { name: "Accéder à mon espace" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();

  await visit(ownerPage, "/", "t04-home-owner");
  await visit(ownerPage, "/clients", "t05-clients");
  await ownerPage.getByRole("link", { name: /^Client A/ }).click();
  await ownerPage.waitForLoadState("networkidle");
  await shot(ownerPage, "t06-client-page");
  await visit(ownerPage, "/memory", "t07-memory-home");
  await ownerPage.getByRole("link", { name: /Mémoire de l'entreprise/ }).click();
  await ownerPage.waitForLoadState("networkidle");
  await shot(ownerPage, "t08-company-memory-empty");
  await visit(ownerPage, "/chat", "t09-new-conversation");
  await visit(ownerPage, "/profile", "t10-profile");
  for (const [path, name] of [
    ["/admin", "t11-admin-overview"],
    ["/admin/company", "t12-admin-company"],
    ["/admin/members", "t13-admin-members"],
    ["/admin/clients", "t14-admin-clients"],
    ["/admin/permissions", "t15-admin-permissions"],
    ["/admin/models", "t16-admin-models"],
    ["/admin/hide", "t17-admin-hide"],
    ["/admin/usage", "t18-admin-usage"],
    ["/admin/quotas", "t19-admin-quotas"],
    ["/admin/activity", "t20-admin-activity"],
  ]) {
    await visit(ownerPage, path, name);
  }
});

test("a member's screens", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await page.goto(await latestLinkFor(member, new Date(0)));
  await shot(page, "t21-invitation");
  await page.getByRole("button", { name: "Accepter l'invitation" }).click();
  await page.getByLabel("Votre nom").fill("Olivier Durand");
  await shot(page, "t22-member-welcome");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Bonjour Olivier" })).toBeVisible();
  await visit(page, "/", "t23-home-member");
  await visit(page, "/clients", "t24-member-clients");
  await visit(page, "/memory", "t25-member-memory");
  // A member has no administration console: back to the home page.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
});

test("the platform console (our team)", async ({ page }) => {
  await signIn(page, "platform@demo.local");
  for (const [path, name] of [
    ["/platform", "t26-platform-companies"],
    ["/platform/plans", "t27-platform-plans"],
    ["/platform/models", "t28-platform-models"],
    ["/platform/audit", "t29-platform-audit"],
    ["/platform/usage", "t29b-platform-usage"],
    ["/platform/health", "t29c-platform-health"],
  ]) {
    await visit(page, path, name);
  }
});

test("on a phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
  const page = await context.newPage();
  await signIn(page, owner);
  await visit(page, "/", "t30-mobile-home");
  await visit(page, "/clients", "t31-mobile-clients");
  await visit(page, "/memory", "t32-mobile-memory");
  await visit(page, "/admin", "t33-mobile-admin");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await shot(page, "t34-mobile-menu");
  await context.close();
});
