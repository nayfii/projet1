import { test, expect, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { shot, signIn, skipAvatarStep } from "./helpers";

/**
 * Sign-in with a password (founder's request, 2026-11-04): the e-mail link stays for the first sign-in;
 * a password is created in the profile; wrong passwords get one neutral message; "forgot password"
 * sends a link to choose a new one; a link sign-in never erases a password chosen in Cendr.
 */
const run = Date.now().toString(36);
const email = `pw-${run}@demo.local`;
const first = "Atelier2026bleu";
const second = "Nouveau2026vert";

test.describe.configure({ mode: "serial" });
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
});

async function signOut(p: Page) {
  await p.context().clearCookies();
  await p.goto("/login");
  await expect(p.getByRole("heading", { name: "Connexion" })).toBeVisible();
}

async function signInWithPassword(p: Page, password: string) {
  await p.goto("/login");
  await p.getByLabel("Adresse e-mail").fill(email);
  await p.getByLabel("Mot de passe", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Se connecter" }).click();
}

test("first sign-in by link; the home page asks for a password; the profile creates it", async () => {
  await signIn(page, email);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Atelier Mot de passe ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page).toHaveURL(/\/chat$/);

  await page.goto("/");
  await expect(page.getByTestId("password-reminder")).toBeVisible();
  await page.getByRole("link", { name: "Créer mon mot de passe" }).click();
  await expect(page).toHaveURL(/\/profile#password$/);
  const card = page.locator("#password");
  // No current password asked: there is none yet.
  await expect(card.getByLabel("Mot de passe actuel")).toHaveCount(0);
  await card.getByLabel("Nouveau mot de passe", { exact: true }).fill("court1");
  await card.getByLabel("Confirmez le nouveau mot de passe").fill("court1");
  await card.getByRole("button", { name: "Créer mon mot de passe" }).click();
  // The browser refuses under 10 characters; the server checks the rule too.
  await expect(page.getByText("Mot de passe enregistré.")).toHaveCount(0);
  await card.getByLabel("Nouveau mot de passe", { exact: true }).fill(first);
  await card.getByLabel("Confirmez le nouveau mot de passe").fill(`${first}x`);
  await card.getByRole("button", { name: "Créer mon mot de passe" }).click();
  await expect(card.getByText("Les deux mots de passe ne sont pas identiques.")).toBeVisible();
  await card.getByLabel("Nouveau mot de passe", { exact: true }).fill(first);
  await card.getByLabel("Confirmez le nouveau mot de passe").fill(first);
  await shot(page, "pw-01-profile");
  await card.getByRole("button", { name: "Créer mon mot de passe" }).click();
  await expect(page.getByText("Mot de passe enregistré.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("password-reminder")).toHaveCount(0);
});

test("sign-in with the password; a wrong one gets one neutral message", async () => {
  await signOut(page);
  await shot(page, "pw-02-login");
  await signInWithPassword(page, "Mauvais2026mdp");
  await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();
  // Same message for an address without an account: nothing tells whether it exists.
  await page.getByLabel("Adresse e-mail").fill(`personne-${run}@demo.local`);
  await page.getByLabel("Mot de passe", { exact: true }).fill(first);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();

  await signInWithPassword(page, first);
  await expect(page.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();
});

test("a sign-in link keeps the password chosen in Cendr", async () => {
  await signOut(page);
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();
  await signOut(page);
  await signInWithPassword(page, first);
  await expect(page.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();
});

test("changing it asks for the current password", async () => {
  await page.goto("/profile#password");
  const card = page.locator("#password");
  await card.getByLabel("Mot de passe actuel").fill("Mauvais2026mdp");
  await card.getByLabel("Nouveau mot de passe", { exact: true }).fill(second);
  await card.getByLabel("Confirmez le nouveau mot de passe").fill(second);
  await card.getByRole("button", { name: "Changer le mot de passe" }).click();
  await expect(card.getByText("Mot de passe actuel incorrect.")).toBeVisible();
});

test("forgot password: a link, a new password, the old one stops working", async () => {
  await signOut(page);
  await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
  await expect(page.getByRole("heading", { name: "Mot de passe oublié" })).toBeVisible();
  const before = new Date(Date.now() - 1000);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();
  await shot(page, "pw-03-forgot-sent");

  await page.goto(await latestLinkFor(email, before));
  await expect(page.getByRole("heading", { name: "Nouveau mot de passe" })).toBeVisible();
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(second);
  await page.getByLabel("Confirmez le nouveau mot de passe").fill(second);
  await shot(page, "pw-04-reset");
  await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
  await expect(page.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();

  await signOut(page);
  await signInWithPassword(page, first);
  await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();
  await signInWithPassword(page, second);
  await expect(page.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();
});

test("an unknown address gets the same answer to \"forgot password\"", async () => {
  await signOut(page);
  await page.goto("/forgot-password");
  await page.getByLabel("Adresse e-mail").fill(`inconnu-${run}@demo.local`);
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();
});

test("our team sets its own password from the console's account menu", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform");
  await admin.getByRole("button", { name: /platform@demo\.local/ }).click();
  await admin.getByRole("menuitem", { name: "Mot de passe" }).click();
  await expect(admin).toHaveURL(/\/platform\/password$/);
  await expect(admin.locator("#password")).toBeVisible();
  await admin.context().close();
});

test("our team gives the console to a new address from Équipe: it lands in the console at its first sign-in", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform/team");
  const newcomer = `equipe-${run}@demo.local`;
  await admin.getByLabel("Adresse e-mail").fill(newcomer);
  await admin.getByRole("button", { name: "Donner l'accès" }).click();
  await expect(admin.getByText(`Invitation enregistrée : ${newcomer} aura accès à sa première connexion.`)).toBeVisible();
  await expect(admin.getByTestId("team-invite").filter({ hasText: newcomer })).toBeVisible();
  await shot(admin, "pw-05-team");

  const them = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(them, newcomer);
  await expect(them).toHaveURL(/\/platform$/);
  await admin.reload();
  await expect(admin.getByTestId("team-member").filter({ hasText: newcomer })).toBeVisible();
  await expect(admin.getByTestId("team-invite")).toHaveCount(0);
  // And it can be taken back.
  await admin.getByRole("button", { name: `Retirer l'accès de ${newcomer}` }).click();
  await expect(admin.getByTestId("team-member").filter({ hasText: newcomer })).toHaveCount(0);
  await them.context().close();
  await admin.context().close();
});
