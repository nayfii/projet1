import { test, expect, type Browser, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { shot, signIn } from "./helpers";

/**
 * Step 6, tools (CLAUDE.md §4.6, §4.7, §10 step 11): Olivier turns a conversation into a tool and asks
 * for company-wide publication; the Owner approves it; the tool runs as a form and continues as a
 * conversation, through Hide and the usual rules. AI_FAKE_PROVIDER=true (simulated, "[TEST]").
 */
const run = Date.now().toString(36);
const owner = `tools-owner-${run}@demo.local`;
const olivier = `tools-olivier-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

let ownerPage: Page;
let olivierPage: Page;
let toolUrl: string;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  ownerPage = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  olivierPage = await (await browser.newContext({ locale: "fr-FR" })).newPage();
});

const answers = (p: Page) => p.locator("article");

test("setup: a company, Client A and Olivier", async () => {
  await signIn(ownerPage, owner);
  await ownerPage.getByLabel("Votre nom").fill("Claire Martin");
  await ownerPage.getByLabel("Nom de l'entreprise").fill(`Atelier Outils ${run}`);
  await ownerPage.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await ownerPage.getByLabel("Adresses e-mail").fill(olivier);
  await ownerPage.getByRole("button", { name: "Envoyer les invitations" }).click();
  await expect(ownerPage.getByText("E-mail envoyé")).toHaveCount(1);
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await ownerPage.getByLabel("Nom du client").fill("Client A");
  await ownerPage.getByRole("button", { name: "Créer le client" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Votre premier document" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await ownerPage.getByRole("button", { name: "Accéder à mon espace" }).click();

  await olivierPage.goto(await latestLinkFor(olivier, new Date(0)));
  await olivierPage.getByRole("button", { name: "Accepter l'invitation" }).click();
  await olivierPage.getByLabel("Votre nom").fill("Olivier Durand");
  await olivierPage.getByRole("button", { name: "Continuer" }).click();
  await expect(olivierPage.getByRole("heading", { name: "Bonjour Olivier" })).toBeVisible();
});

test("Olivier turns a conversation into a tool and asks to share it with the whole company", async () => {
  await olivierPage.goto("/chat");
  await olivierPage.getByRole("textbox", { name: "Écrivez votre message…" }).fill("Résume ces notes de réunion en trois points et propose une prochaine étape.");
  await olivierPage.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers(olivierPage)).toHaveCount(1, { timeout: 20_000 });
  await expect(olivierPage.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });

  await olivierPage.getByRole("button", { name: "Actions sur la conversation" }).click();
  await olivierPage.getByRole("menuitem", { name: "Transformer en outil" }).click();
  const dialog = olivierPage.getByRole("dialog", { name: "Transformer en outil" });
  await expect(dialog.getByLabel("Nom")).toHaveValue("[TEST] Synthèse client", { timeout: 20_000 });
  await expect(dialog.getByRole("textbox", { name: "Intitulé du champ" })).toHaveCount(2);
  await expect(dialog.getByLabel("Instructions pour l'IA")).toHaveValue(/Résume les notes de réunion/);
  // "My team" needs a team: shown, not selectable.
  await expect(dialog.getByRole("radio", { name: /Mon équipe/ })).toBeDisabled();
  await dialog.getByRole("radio", { name: /Toute l'entreprise/ }).check();
  await shot(olivierPage, "75-turn-into-tool");
  await dialog.getByRole("button", { name: "Enregistrer et demander la validation" }).click();
  await expect(olivierPage.getByText("Il sera visible par toute l'entreprise après validation")).toBeVisible();
  await expect(olivierPage).toHaveURL(/\/library\/[0-9a-f-]{36}$/);
  toolUrl = olivierPage.url();
  await expect(olivierPage.getByText("En attente de validation")).toBeVisible();
});

test("the library is organised by department, with the launch agents to come", async () => {
  await olivierPage.goto("/library");
  const sales = olivierPage.getByRole("region", { name: "Ventes" });
  await expect(sales.getByRole("link", { name: /\[TEST\] Synthèse client/ })).toBeVisible();
  await expect(sales).toContainText("Proposition commerciale");
  await expect(olivierPage.getByRole("region", { name: "Juridique" })).toContainText("Relecture de contrat");
  await shot(olivierPage, "76-library");
  // Not yet approved: invisible to the Owner's library, but waiting in Administration.
  await ownerPage.goto("/library");
  await expect(ownerPage.getByRole("link", { name: /\[TEST\] Synthèse client/ })).toHaveCount(0);
});

test("the Owner approves it in Administration → Agents and tools", async () => {
  await ownerPage.goto("/admin/agents");
  await expect(ownerPage.getByRole("heading", { name: "À valider (1)" })).toBeVisible();
  await ownerPage.getByText("Voir le contenu").click();
  await expect(ownerPage.getByText("Champs : Client, Notes de réunion")).toBeVisible();
  await shot(ownerPage, "77-admin-approve");
  await ownerPage.getByRole("button", { name: "Valider" }).click();
  await expect(ownerPage.getByText("Outil validé pour toute l'entreprise.")).toBeVisible();
  await ownerPage.reload();
  await expect(ownerPage.getByRole("heading", { name: "À valider (0)" })).toBeVisible();
  await expect(ownerPage.getByRole("checkbox", { name: "Membre" })).toBeChecked();
});

test("the tool runs as a form and continues as a conversation, with Hide", async () => {
  await ownerPage.goto(toolUrl);
  await ownerPage.getByRole("combobox", { name: "Client" }).click();
  await ownerPage.getByRole("option", { name: "Client A" }).click();
  await ownerPage.getByLabel("Notes de réunion *").fill("Budget validé, livraison en mars.");
  await shot(ownerPage, "78-run-form");
  await ownerPage.getByRole("button", { name: "Lancer" }).click();
  await expect(ownerPage).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(answers(ownerPage)).toHaveCount(1, { timeout: 20_000 });
  await expect(ownerPage.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  const answer = answers(ownerPage).last();
  await expect(answer).toContainText("Tool instructions received: [TEST] Synthèse client");
  // The form became the first message; the client's name was masked for the AI and restored here.
  await expect(answer).toContainText("Budget validé, livraison en mars.");
  await expect(answer).toContainText("Client A");
  await answer.getByRole("button", { name: "Voir la réponse telle que l'IA l'a écrite" }).click();
  await expect(answer).toContainText("[CLIENT_1]");
  // The conversation shows which tool it runs, with a link back to it.
  await expect(ownerPage.getByRole("link", { name: "[TEST] Synthèse client", exact: true })).toBeVisible();
  await shot(ownerPage, "79-tool-answer");
});
