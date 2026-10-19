import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { shot, signIn } from "./helpers";

/**
 * Step 5, with two people in two browsers (CLAUDE.md §10, steps 8, 9 and 13): Who Can Help, adding a
 * colleague with part of the history, real time, mentions, the AI's shared context, transferring a
 * conversation and a restricted client with a Smart Handover. The server must run with
 * AI_FAKE_PROVIDER=true (simulated answers, labelled "[TEST]").
 */
const run = Date.now().toString(36);
const owner = `collab-owner-${run}@demo.local`;
const olivier = `collab-olivier-${run}@demo.local`;
const nathalie = `collab-nathalie-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
let ownerPage: Page, olivierPage: Page, nathaliePage: Page;
let conversationUrl: string;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const open = async () => {
    const context = await browser.newContext({ locale: "fr-FR" });
    contexts.push(context);
    return context.newPage();
  };
  [ownerPage, olivierPage, nathaliePage] = [await open(), await open(), await open()];
});
test.afterAll(async () => Promise.all(contexts.map((c) => c.close())));

const answers = (p: Page) => p.locator("article");
const userMessages = (p: Page) => p.locator(".group\\/user");
const soloComposer = (p: Page) => p.getByRole("textbox", { name: "Écrivez votre message…" });
const groupComposer = (p: Page) => p.getByRole("textbox", { name: "Écrivez à l'équipe… @IA pour faire répondre l'IA" });

async function waitForAnswer(p: Page, before: number) {
  await expect(answers(p)).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(p.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

async function join(page: Page, email: string, name: string, expertise?: string) {
  await page.goto(await latestLinkFor(email, new Date(0)));
  await page.getByRole("button", { name: "Accepter l'invitation" }).click();
  await page.getByLabel("Votre nom").fill(name);
  if (expertise) await page.getByLabel("Domaines d'expertise").fill(expertise);
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: `Bonjour ${name.split(" ")[0]}` })).toBeVisible();
}

test("setup: Client A is restricted to Olivier, with a memory entry; Nathalie declares finance", async () => {
  await signIn(ownerPage, owner);
  await ownerPage.getByLabel("Votre nom").fill("Claire Martin");
  await ownerPage.getByLabel("Nom de l'entreprise").fill(`Atelier Collab ${run}`);
  await ownerPage.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await ownerPage.getByLabel("Adresses e-mail").fill(`${olivier}, ${nathalie}`);
  await ownerPage.getByRole("button", { name: "Envoyer les invitations" }).click();
  await expect(ownerPage.getByText("E-mail envoyé")).toHaveCount(2);
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Ajoutez un premier client" })).toBeVisible();
  await ownerPage.getByLabel("Nom du client").fill("Client A");
  await ownerPage.getByRole("button", { name: /Restreint/ }).click();
  await ownerPage.getByRole("button", { name: "Créer le client" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Votre premier document" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await ownerPage.getByRole("button", { name: "Accéder à mon espace" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();

  await join(olivierPage, olivier, "Olivier Martin");
  await join(nathaliePage, nathalie, "Nathalie Durand", "finance, trésorerie");

  await ownerPage.goto("/admin/clients");
  await ownerPage.getByRole("button", { name: /Personne n'a accès/ }).click();
  await ownerPage.getByRole("checkbox").first().waitFor();
  await ownerPage.getByText("Olivier Martin").click();
  await expect(ownerPage.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await ownerPage.getByRole("button", { name: "Terminé" }).click();

  await olivierPage.goto("/memory");
  await olivierPage.getByRole("link", { name: /Client A/ }).click();
  await olivierPage.getByRole("button", { name: "Nouvelle entrée" }).first().click();
  const dialog = olivierPage.getByRole("dialog");
  await dialog.getByLabel("Titre").fill("Budget Client A");
  await dialog.getByLabel("Contenu").fill("Le budget annuel du Client A est de 80 000 euros.");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(olivierPage.getByText("Entrée enregistrée en mémoire.")).toBeVisible();
});

test("Olivier's AI uses his Client A memory; a finance question suggests Nathalie (Who Can Help)", async () => {
  await olivierPage.goto("/chat");
  await soloComposer(olivierPage).fill("Quel est le budget annuel du Client A ?");
  await olivierPage.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswer(olivierPage, 0);
  await expect(answers(olivierPage).last()).toContainText("Knowledge passages received");
  await expect(answers(olivierPage).last().getByRole("region", { name: "Sources" })).toContainText("Budget Client A");
  conversationUrl = olivierPage.url();

  await soloComposer(olivierPage).fill("J'ai besoin d'aide sur la trésorerie de ce dossier.");
  await olivierPage.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswer(olivierPage, 1);
  await expect(answers(olivierPage).last()).toContainText("You can ask Nathalie Durand about it.");
  await expect(olivierPage.getByRole("button", { name: "Inviter Nathalie Durand" })).toBeVisible();
  await shot(olivierPage, "60-who-can-help");
});

test("Olivier adds Nathalie from the suggestion, sharing history from a chosen message", async () => {
  await nathaliePage.goto("/");
  await olivierPage.getByRole("button", { name: "Inviter Nathalie Durand" }).click();
  const dialog = olivierPage.getByRole("dialog", { name: "Ajouter des collègues" });
  await expect(dialog.getByRole("checkbox", { name: "Nathalie Durand" })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /À partir de maintenant/ })).toBeChecked();
  await expect(dialog).toContainText("Le titre de la conversation est visible par tous");

  // The whole conversation would include an answer citing Client A's memory: the app warns.
  await dialog.getByRole("radio", { name: /Toute la conversation/ }).check();
  await expect(dialog.getByRole("alert")).toContainText("Ces messages citent la mémoire de Client A, que Nathalie Durand ne peut pas consulter");
  await expect(dialog.getByRole("button", { name: "Ajouter quand même" })).toBeVisible();
  await shot(olivierPage, "61-add-people-warning");

  // From the finance question on: nothing from Client A's memory, no warning.
  await dialog.getByRole("radio", { name: /^Olivier Martin · .*J'ai besoin d'aide sur la trésorerie/ }).check();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await shot(olivierPage, "62-add-people-history");
  await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(olivierPage.getByText("Collègue ajouté(e).")).toBeVisible();
  await expect(olivierPage.getByRole("link", { name: /Quel est le budget annuel du Client A/ })).toBeVisible();
  await expect(groupComposer(olivierPage)).toBeVisible();
});

test("real time: the conversation appears for Nathalie, from the shared message on; they talk without the AI", async () => {
  // Her sidebar updates without reloading.
  const link = nathaliePage.getByRole("link", { name: /Quel est le budget annuel du Client A/ });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
  await expect(groupComposer(nathaliePage)).toBeVisible();
  await expect(userMessages(nathaliePage)).toHaveCount(1);
  await expect(userMessages(nathaliePage).first()).toContainText("Olivier Martin");
  await expect(userMessages(nathaliePage).first()).toContainText("J'ai besoin d'aide sur la trésorerie");
  await expect(nathaliePage.getByText("Knowledge passages received")).toHaveCount(0);
  await expect(answers(nathaliePage)).toHaveCount(1);

  await groupComposer(nathaliePage).pressSequentially("Je regarde", { delay: 30 });
  await expect(olivierPage.getByText("Nathalie Durand écrit…")).toBeVisible({ timeout: 10_000 });
  await groupComposer(nathaliePage).fill("Je regarde la trésorerie, je reviens vers toi.");
  await nathaliePage.getByRole("button", { name: "Envoyer" }).click();
  await expect(userMessages(nathaliePage)).toHaveCount(2);

  // Olivier sees her message live; the AI was not mentioned, so nobody answered.
  await expect(userMessages(olivierPage).last()).toContainText("Je regarde la trésorerie", { timeout: 10_000 });
  await expect(userMessages(olivierPage).last()).toContainText("Nathalie Durand");
  await expect(answers(olivierPage)).toHaveCount(2);
  await expect(answers(nathaliePage)).toHaveCount(1);
  await shot(nathaliePage, "63-group-nathalie");
});

test("@Claude answers with only what both can access: Client A's memory is left out", async () => {
  await groupComposer(olivierPage).click();
  await groupComposer(olivierPage).pressSequentially("@");
  const menu = olivierPage.getByRole("listbox", { name: "Faire répondre l'IA" });
  await expect(menu).toBeVisible();
  for (const token of ["@IA", "@ChatGPT", "@Claude", "@Gemini"]) await expect(menu).toContainText(token);
  await shot(olivierPage, "64-mention-menu");
  await groupComposer(olivierPage).pressSequentially("Cl");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await groupComposer(olivierPage).press("Enter");
  await expect(groupComposer(olivierPage)).toHaveValue("@Claude ");
  await groupComposer(olivierPage).pressSequentially("quel est le budget annuel du Client A ?");
  await olivierPage.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswer(olivierPage, 2);

  const answer = answers(olivierPage).last();
  await expect(answer).toContainText(/Simulated answer from claude/);
  await expect(answer).not.toContainText("Knowledge passages received");
  await expect(answer).toContainText("Contexte limité à ce que tout le monde ici peut voir");
  // Nathalie is already here: the AI does not suggest inviting her. "@Claude" is not a hidden name.
  await expect(answer).not.toContainText("You can ask Nathalie");
  await expect(userMessages(olivierPage).last().locator(".line-through", { hasText: "Claude" })).toHaveCount(0);
  await shot(olivierPage, "65-mention-answer");

  // Nathalie sees the answer arrive without reloading.
  await expect(answers(nathaliePage)).toHaveCount(2, { timeout: 15_000 });
  await expect(answers(nathaliePage).last()).toContainText("Simulated answer from", { timeout: 15_000 });
  await expect(answers(nathaliePage).last()).toContainText("Contexte limité");
  await shot(nathaliePage, "66-group-answer-live");
});

test("transfer with Smart Handover: Olivier loses access, Nathalie gets the whole history and the file", async () => {
  await olivierPage.getByRole("button", { name: "Actions sur la conversation" }).click();
  await olivierPage.getByRole("menuitem", { name: "Transférer…" }).click();
  const dialog = olivierPage.getByRole("dialog", { name: "Transférer la conversation" });
  await dialog.getByRole("radio", { name: /Nathalie Durand/ }).check();
  await expect(dialog.getByRole("alert")).toContainText("Cette conversation cite la mémoire de Client A");
  await expect(dialog).toContainText("Cette action est définitive pour vous");
  await shot(olivierPage, "67-transfer-dialog");
  await dialog.getByRole("button", { name: "Transférer quand même" }).click();
  await expect(olivierPage.getByText("Transféré à Nathalie Durand.")).toBeVisible({ timeout: 20_000 });
  await expect(olivierPage).toHaveURL(/\/chat$/);
  await expect(olivierPage.getByRole("link", { name: /Quel est le budget annuel du Client A/ })).toHaveCount(0);
  await olivierPage.goto(conversationUrl);
  await expect(olivierPage.getByRole("heading", { name: "Page introuvable" })).toBeVisible();

  await nathaliePage.goto(conversationUrl);
  const handover = nathaliePage.getByRole("region", { name: "Dossier de passation" });
  await expect(handover).toContainText("Vous reprenez le travail de Olivier Martin.");
  await expect(handover).toContainText("[TEST] Résumé du travail réalisé.");
  await expect(handover).toContainText("Prochaines actions");
  // The whole history now, but the Source Proof of Client A's memory stays hidden from her.
  await expect(userMessages(nathaliePage).first()).toContainText("Quel est le budget annuel du Client A ?");
  await expect(answers(nathaliePage).first().getByRole("region", { name: "Sources" })).toHaveCount(0);
  await shot(nathaliePage, "68-handover");

  await handover.getByRole("button", { name: "Modifier" }).click();
  await handover.getByLabel("Résumé").fill("Trésorerie à revoir avec le client avant vendredi.");
  await handover.getByRole("button", { name: "Enregistrer" }).click();
  await expect(nathaliePage.getByText("Dossier de passation enregistré.")).toBeVisible();
  await nathaliePage.reload();
  await expect(nathaliePage.getByRole("region", { name: "Dossier de passation" })).toContainText("Trésorerie à revoir avec le client avant vendredi.");
});

test("client transfer: Olivier hands Client A over to Nathalie and loses access", async () => {
  await olivierPage.goto("/clients");
  await olivierPage.getByRole("link", { name: /^Client A Restreint/ }).click();
  await olivierPage.getByRole("button", { name: "Transférer ce client" }).click();
  const dialog = olivierPage.getByRole("dialog", { name: "Transférer le client Client A" });
  await dialog.getByRole("radio", { name: /Nathalie Durand/ }).check();
  await dialog.getByRole("button", { name: "Transférer", exact: true }).click();
  await expect(olivierPage.getByText("Transféré à Nathalie Durand.")).toBeVisible({ timeout: 20_000 });
  await expect(olivierPage).toHaveURL(/\/clients$/);
  await expect(olivierPage.getByText("Aucun client ne vous a encore été attribué.")).toBeVisible();

  await nathaliePage.goto("/clients");
  await nathaliePage.getByRole("link", { name: /^Client A Restreint/ }).click();
  await expect(nathaliePage.getByRole("region", { name: "Dossier de passation" })).toContainText("[TEST] Résumé du travail réalisé.");
  await shot(nathaliePage, "69-client-handover");

  await ownerPage.goto("/admin/activity");
  await expect(ownerPage.getByText("a transféré Client A à Nathalie Durand")).toBeVisible();
  await expect(ownerPage.getByText("a transféré une conversation à Nathalie Durand")).toBeVisible();
  await expect(ownerPage.getByText("a ajouté Nathalie Durand à une conversation")).toBeVisible();
  await shot(ownerPage, "70-activity-collab");
});
