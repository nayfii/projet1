import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { shot, signIn, skipAvatarStep } from "./helpers";

/**
 * Step 12 (CLAUDE.md §11) in a real browser, test mode (AI_FAKE_PROVIDER=true): a client created from
 * the sidebar, the "link to this client" suggestion, client memory fed automatically (with Undo), voice
 * dictation with Chromium's fake microphone, personal notes, the admin switches, deletion for good.
 */
const run = Date.now().toString(36);
const owner = `s12-owner-${run}@demo.local`;
const clientName = `Atlas Sport ${run}`;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR", permissions: ["microphone"] });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

// Chromium's fake device plays a test tone as the microphone; no dialog asks for permission.
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

const composer = () => page.getByRole("textbox", { name: "Écrivez votre message…" });

test("anyone creates a client from the sidebar and lands in its space", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Camille Roux");
  await page.getByLabel("Nom de l'entreprise").fill(`Studio Douze ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.goto("/chat");

  await page.getByRole("button", { name: "Nouveau client" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nouveau client" });
  await dialog.getByLabel("Nom du client").fill(clientName);
  await dialog.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByRole("heading", { name: clientName, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "En bref" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mes conversations" })).toBeVisible();
  await expect(page.getByRole("link", { name: clientName })).toBeVisible();
  await shot(page, "s12-01-client-space");
});

test("naming the client in a chat suggests linking it; the answer feeds its memory, which can be forgotten", async () => {
  await page.goto("/chat");
  await composer().fill(`Prépare la réunion de jeudi avec ${clientName}, ils préfèrent des rapports courts.`);
  const suggestion = page.getByRole("button", { name: `Rattacher à ${clientName} ?` });
  await expect(suggestion).toBeVisible();
  await shot(page, "s12-02-link-suggestion");
  await suggestion.click();
  await expect(suggestion).toBeHidden();

  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.locator("article")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  // Learned on our server after the answer; the line under the answer shows the real result.
  const learned = page.getByTestId("memory-learned");
  await expect(learned).toHaveText(/1 fait appris/, { timeout: 20_000 });
  await learned.click();
  await expect(page.getByTestId("memory-learned-panel")).toContainText(`Ajouté à la mémoire de ${clientName}`);
  await expect(page.getByTestId("memory-learned-panel")).toContainText("rapports courts");
  await shot(page, "s12-03-auto-memory");
  await page.getByRole("button", { name: "Oublier ce qui a été appris" }).click();
  await expect(page.getByText("Oublié. Les versions précédentes sont revenues.")).toBeVisible();
  await expect(learned).toBeHidden();
});

test("voice dictation writes into the message box, to be read before sending", async () => {
  await page.goto("/chat");
  await page.getByRole("button", { name: "Dicter" }).click();
  await expect(page.getByRole("status").filter({ hasText: /0:0\d/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "s12-04-dictation-recording");
  await page.getByRole("button", { name: "Terminer et transcrire" }).click();
  await expect(composer()).toHaveValue("Ceci est une dictée de démonstration (mode test).", { timeout: 20_000 });
  // Nothing is sent on its own.
  await expect(page.locator("article")).toHaveCount(0);
});

test("from a conversation: create a client and link it at once, then detach it", async () => {
  const newName = `Boulangerie Lune ${run}`;
  await page.goto("/chat");
  await composer().fill("Rédige un mot de bienvenue pour un nouveau client.");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Rattacher à un client" }).click();
  await expect(page.getByRole("menuitem", { name: "Aucun client" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Nouveau client" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouveau client" });
  await dialog.getByLabel("Nom du client").fill(newName);
  await dialog.getByRole("button", { name: "Créer le client" }).click();
  // Linked at once: the header names the client, and so does the conversation in the sidebar.
  const header = page.getByRole("button", { name: newName });
  await expect(header).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: newName })).toBeVisible();
  await shot(page, "s12-08-new-client-linked");

  await page.getByRole("button", { name: newName }).click();
  await expect(page.getByRole("menuitem", { name: "Nouveau client" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: `Détacher de ${newName}` }).click();
  await expect(page.getByText(`Conversation détachée de ${newName}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Rattacher à un client" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Rattacher à un client" })).toBeVisible();
});

test("personal notes live on the profile page, for this person only", async () => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Ce que l'IA sait de moi" })).toBeVisible();
  await page.getByRole("textbox", { name: "Ajouter" }).fill("Réponds-moi en points courts.");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText("Réponds-moi en points courts.")).toBeVisible();
  await shot(page, "s12-05-personal-memory");
});

test("the Owner switches dictation off for the company: the microphone disappears", async () => {
  await page.goto("/admin/models");
  const dictation = page.getByRole("switch", { name: "Dictée vocale" });
  await expect(dictation).toBeChecked();
  await expect(page.getByRole("switch", { name: "Mémoire client automatique" })).toBeChecked();
  await shot(page, "s12-06-ai-features");
  await dictation.click();
  await expect(page.getByText("Réglage enregistré")).toBeVisible();
  await page.goto("/chat");
  await expect(composer()).toBeVisible();
  await expect(page.getByRole("button", { name: "Dicter" })).toHaveCount(0);
  await page.goto("/admin/models");
  await page.getByRole("switch", { name: "Dictée vocale" }).click();
  await expect(page.getByText("Réglage enregistré")).toBeVisible();
});

test("a client is deleted for good by the Owner only once archived, retyping its name", async () => {
  await page.goto("/admin/clients");
  const row = page.locator("div", { has: page.getByText(clientName, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Actions" }) }).last();
  await row.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Archiver" }).click();
  await expect(page.getByText("Client archivé")).toBeVisible();

  await page.getByRole("button", { name: "Supprimer définitivement" }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Supprimer pour de bon" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill("Atlas");
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill(clientName.toLowerCase());
  await shot(page, "s12-07-delete-client");
  await confirm.click();
  await expect(page.getByText("Client supprimé définitivement")).toBeVisible();
  await expect(page.getByText(clientName, { exact: true })).toHaveCount(0);
});
