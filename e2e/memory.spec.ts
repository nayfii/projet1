import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { shot, signIn } from "./helpers";

/**
 * Step 3, in a real browser: company and client memories, documents, Source Proof, saving to memory,
 * AI suggestions and promotion, memory rights, and a colleague without access to a restricted client.
 * The server must run with AI_FAKE_PROVIDER=true (simulated answers and embeddings, labelled "[TEST]").
 */
const run = Date.now().toString(36);
const owner = `memory-owner-${run}@demo.local`;
const nathalie = `memory-nathalie-${run}@demo.local`;
const company = `Atelier Mémoire ${run}`;

const CONTRACT = [
  "Contrat cadre entre Atelier et Client A.",
  "",
  "Article 4 — Remise annuelle. Le contrat prévoit une remise de 12 % sur les commandes annuelles passées avant le 31 mars.",
  "",
  "Article 5 — Délais. Les livraisons ont lieu sous dix jours ouvrés.",
].join("\n");

const PROCEDURE = "Procédure interne : chaque devis est relu par un associé avant envoi. Les devis sont valables trente jours.";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let clientSpaceUrl: string;
let documentUrl: string;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR" });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

const answers = (p: Page) => p.locator("article");

async function send(p: Page, text: string) {
  const before = await answers(p).count();
  await p.getByRole("textbox", { name: "Écrivez votre message…" }).fill(text);
  await p.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers(p)).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(p.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

test("onboarding: the first document goes into the company memory", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(company);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();

  await expect(page.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await page.getByLabel("Adresses e-mail").fill(nathalie);
  await page.getByRole("button", { name: "Envoyer les invitations" }).click();
  await expect(page.getByText("E-mail envoyé")).toHaveCount(1);
  await page.getByRole("button", { name: "Continuer" }).click();

  await expect(page.getByRole("heading", { name: "Ajoutez un premier client" })).toBeVisible();
  await page.getByLabel("Nom du client").fill("Client A");
  await page.getByRole("button", { name: /Restreint/ }).click();
  await page.getByRole("button", { name: "Créer le client" }).click();

  await expect(page.getByRole("heading", { name: "Votre premier document" })).toBeVisible();
  await page.getByTestId("memory-document-input").first().setInputFiles({ name: "procedure-devis.txt", mimeType: "text/plain", buffer: Buffer.from(PROCEDURE) });
  await expect(page.getByText("Document ajouté. Il est en cours de lecture")).toBeVisible();
  await shot(page, "30-onboarding-document");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();
  await expect(page.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();

  await page.goto("/memory");
  await page.getByRole("link", { name: /Mémoire de l'entreprise/ }).click();
  await page.getByRole("tab", { name: /Documents/ }).click();
  await expect(page.getByText("procedure-devis.txt")).toBeVisible();
  await expect(page.getByText(/Prêt · 1 passage/)).toBeVisible({ timeout: 20_000 });
});

test("a document added to Client A's memory is read and split into passages", async () => {
  await page.goto("/memory");
  await shot(page, "31-memory-home");
  await page.getByRole("link", { name: /Client A/ }).click();
  await expect(page).toHaveURL(/\/memory\/[0-9a-f-]{36}$/);
  clientSpaceUrl = page.url();
  await page.getByRole("tab", { name: /Documents/ }).click();
  await page.getByTestId("memory-document-input").first().setInputFiles({ name: "contrat-client-a.txt", mimeType: "text/plain", buffer: Buffer.from(CONTRACT) });
  await expect(page.getByText("« contrat-client-a.txt » ajouté. Lecture en cours…")).toBeVisible();
  await expect(page.getByText("contrat-client-a.txt")).toBeVisible();
  await expect(page.getByText(/Prêt · 1 passage/)).toBeVisible({ timeout: 20_000 });
  // Simulated embeddings work in test mode: the document is searchable by meaning, not only by words.
  await expect(page.getByText("Recherche par mots uniquement")).toHaveCount(0);
  await shot(page, "32-client-memory-documents");
});

test("an answer about Client A shows Source Proof, down to the exact passage", async () => {
  await page.goto("/chat");
  await page.getByRole("button", { name: "Rattacher à un client" }).click();
  await page.getByRole("menuitem", { name: "Client A" }).click();
  await send(page, "Quelle remise annuelle prévoit le contrat de Client A ?");

  const answer = answers(page).last();
  await expect(answer).toContainText("Knowledge passages received");
  const sources = answer.getByRole("region", { name: "Sources" });
  await expect(sources).toBeVisible();
  await expect(sources).toContainText("contrat-client-a.txt");
  await expect(sources).toContainText("Mémoire · Client A");
  // The [S1] citation in the text is a clickable badge.
  await expect(answer.getByRole("button", { name: "1", exact: true }).first()).toBeVisible();
  await shot(page, "33-chat-source-proof");

  await sources.getByRole("button", { name: /contrat-client-a\.txt/ }).click();
  const sheet = page.getByRole("dialog", { name: "Passage cité" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Passage exact transmis à l'IA");
  await expect(sheet).toContainText("remise de 12 %");
  await shot(page, "34-source-passage");

  await sheet.getByRole("link", { name: "Ouvrir le document à ce passage" }).click();
  await expect(page.getByRole("heading", { name: "contrat-client-a.txt" })).toBeVisible();
  await expect(page.getByLabel("Passage cité")).toContainText("remise de 12 %");
  documentUrl = page.url().split("?")[0];
  await shot(page, "35-document-highlight");
  // Back to the conversation with the browser's Back button: the conversation is there, not an empty page.
  await page.goBack();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).last()).toContainText("Knowledge passages received");
});

test("an answer can be saved to memory, after rereading it", async () => {
  const answer = answers(page).last();
  await answer.hover();
  await answer.getByRole("button", { name: "Enregistrer en mémoire" }).click();
  const dialog = page.getByRole("dialog", { name: "Enregistrer en mémoire" });
  await expect(dialog.getByRole("combobox", { name: "Dans quelle mémoire ?" })).toContainText("Client A");
  await dialog.getByLabel("Titre").fill("Remise annuelle Client A");
  await dialog.getByLabel("Contenu").fill("Client A bénéficie d'une remise de 12 % sur les commandes annuelles passées avant le 31 mars.");
  await shot(page, "36-save-to-memory");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Entrée enregistrée en mémoire.")).toBeVisible();
});

test("the AI proposes memory entries; nothing is saved until approved", async () => {
  await page.getByRole("button", { name: "Actions sur la conversation" }).click();
  await page.getByRole("menuitem", { name: "Proposer des entrées de mémoire" }).click();
  const dialog = page.getByRole("dialog", { name: "Proposer des entrées de mémoire" });
  await expect(dialog.getByLabel("Titre")).toHaveValue("[TEST] Point clé", { timeout: 20_000 });
  await shot(page, "37-ai-suggestions");
  await dialog.getByRole("button", { name: "Approuver" }).click();
  await expect(dialog.getByText("Ajouté à la mémoire.")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(clientSpaceUrl);
  await expect(page.getByText("Remise annuelle Client A")).toBeVisible();
  await expect(page.getByText("[TEST] Point clé")).toBeVisible();
  await expect(page.getByText("Depuis une conversation").first()).toBeVisible();
  await expect(page.getByText("Suggestion de l'IA approuvée")).toBeVisible();
  await shot(page, "38-client-memory-entries");
});

test("a general learning is promoted to the company memory only after approval", async () => {
  const entry = page.locator('[id^="entry-"]').filter({ hasText: "Remise annuelle Client A" });
  await entry.getByRole("button", { name: "Actions sur l'entrée" }).click();
  await page.getByRole("menuitem", { name: "Proposer pour la mémoire de l'entreprise" }).click();
  await expect(page.getByText("Enseignement général proposé")).toBeVisible({ timeout: 20_000 });

  await page.goto("/memory");
  await page.getByRole("link", { name: /Mémoire de l'entreprise/ }).click();
  await expect(page.getByRole("tab", { name: /Suggestions/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Enseignement général").first()).toBeVisible();
  await expect(page.getByLabel("Contenu")).not.toHaveValue(/12 %|Client A/);
  await shot(page, "39-promotion-suggestion");
  await page.getByRole("button", { name: "Approuver" }).click();
  await expect(page.getByText("Ajouté à la mémoire.").first()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /Entrées/ }).click();
  await expect(page.getByText("[TEST] Enseignement général")).toBeVisible();
});

test("Nathalie, without access to Client A, gets nothing from it: pages, links or AI", async ({ browser }) => {
  const nathalieContext = await browser.newContext({ locale: "fr-FR" });
  const p = await nathalieContext.newPage();
  await p.goto(await latestLinkFor(nathalie, new Date(0)));
  await p.getByRole("button", { name: "Accepter l'invitation" }).click();
  await p.getByLabel("Votre nom").fill("Nathalie Petit");
  await p.getByRole("button", { name: "Continuer" }).click();
  await expect(p.getByRole("heading", { name: "Bonjour Nathalie" })).toBeVisible();

  await p.goto("/memory");
  await expect(p.getByText("Aucune mémoire client accessible")).toBeVisible();
  await expect(p.getByRole("link", { name: /Mémoire de l'entreprise/ })).toContainText("Lecture seule");
  await shot(p, "40-member-memory");

  // The exact addresses of Client A's memory and document: "page not found", nothing revealed.
  for (const url of [clientSpaceUrl, documentUrl]) {
    await p.goto(url);
    await expect(p.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  }
  const file = await p.request.get(`${documentUrl.replace("/memory/documents/", "/api/documents/")}/file`);
  expect(file.status()).toBe(404);

  // Same question to the AI: Client A's memory is never used, only the company's.
  await p.goto("/chat");
  await send(p, "Quelle remise annuelle prévoit le contrat de Client A ?");
  const answer = answers(p).last();
  await expect(answer).toContainText("[TEST]");
  await expect(answer).not.toContainText("contrat-client-a.txt");
  await expect(answer).not.toContainText("Mémoire · Client A");
  await expect(answer).not.toContainText("12 %");
  await nathalieContext.close();
});

test("the owner gives the Finance group the right to write in the company memory", async ({ browser }) => {
  await page.goto("/admin/permissions");
  await expect(page.getByText("Tout le monde", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nouveau groupe" }).click();
  const groupDialog = page.getByRole("dialog", { name: "Nouveau groupe" });
  await groupDialog.getByLabel("Nom").fill("Finance");
  await groupDialog.getByText("Nathalie Petit").click();
  await groupDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Groupe enregistré.")).toBeVisible();
  await expect(page.getByText("1 membre").first()).toBeVisible();

  await page.getByRole("button", { name: "Modifier l'accès à Mémoire de l'entreprise" }).click();
  const grants = page.getByRole("dialog", { name: "Mémoire de l'entreprise" });
  await grants.getByRole("checkbox", { name: "Finance peut écrire" }).click();
  await shot(page, "41-admin-permissions-grants");
  await grants.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Accès enregistré.")).toBeVisible();
  await expect(page.getByText("Écriture : Direction, Finance")).toBeVisible();
  await shot(page, "42-admin-permissions");

  const nathalieContext = await browser.newContext({ locale: "fr-FR" });
  const p = await nathalieContext.newPage();
  await signIn(p, nathalie);
  await p.goto("/memory");
  await expect(p.getByRole("link", { name: /Mémoire de l'entreprise/ })).not.toContainText("Lecture seule");
  await p.getByRole("link", { name: /Mémoire de l'entreprise/ }).click();
  await p.getByRole("tab", { name: /Entrées/ }).click();
  await expect(p.getByRole("button", { name: "Nouvelle entrée" }).first()).toBeVisible();
  await nathalieContext.close();
});
