import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { shot, signIn } from "./helpers";

/**
 * Step 2, in a real browser against the production build. The server must run with
 * AI_FAKE_PROVIDER=true: answers are simulated (labelled "[TEST]"), so this test is free and
 * deterministic. Real providers are covered by `pnpm test:smoke`.
 */
const run = Date.now().toString(36);
const owner = `chat-owner-${run}@demo.local`;
const company = `Atelier Chat ${run}`;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let conversationUrl: string;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR", permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

const composer = () => page.getByRole("textbox", { name: "Écrivez votre message…" });
const answers = () => page.locator("article");

/** Sends a message and waits until the answer is completely written. */
async function send(text: string) {
  const before = await answers().count();
  await composer().fill(text);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers()).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

test("an owner starts a conversation; Auto picks the model and explains why", async () => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(company);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();

  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "Que puis-je faire pour vous ?" })).toBeVisible();
  await expect(page.getByText("Mode test : les réponses sont simulées")).toBeVisible();
  await shot(page, "20-chat-empty");

  await send("Rédige un e-mail de relance pour le devis envoyé au client Dupont la semaine dernière");
  const first = answers().first();
  await expect(first).toContainText("[TEST] Simulated answer from claude-sonnet-5-5");
  await expect(first).toContainText("Auto : rédaction, priorité à la qualité");
  await expect(first.getByText("Claude", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  conversationUrl = page.url();
  // The conversation appears in the sidebar with a title taken from the first message.
  await expect(page.getByRole("link", { name: /Rédige un e-mail de relance/ })).toBeVisible();
  await shot(page, "21-chat-auto");
});

test("switching model mid-conversation keeps the context", async () => {
  await page.getByRole("button", { name: "Choisir le modèle" }).click();
  await expect(page.getByRole("menuitem", { name: /Auto/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /GPT-6 Luna/ }).click();
  await send("Fais-en une version plus courte");
  const second = answers().nth(1);
  await expect(second).toContainText("Simulated answer from gpt-6-luna");
  // The new model received the whole conversation built by the platform: 2 questions + 1 answer.
  await expect(second).toContainText("Messages received: 3 (2 from people)");
  await expect(page.getByRole("separator").filter({ hasText: "Suite avec" })).toContainText("GPT-6 Luna");
  await shot(page, "22-chat-switch-model");

  // Still there after a reload: everything is saved.
  await page.reload();
  await expect(answers()).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Choisir le modèle" })).toContainText("GPT-6 Luna");
});

test("copy, regenerate, and regenerate with another model", async () => {
  await page.getByRole("button", { name: "Copier" }).last().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("[TEST] Simulated answer from **gpt-6-luna**");

  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect(page.getByRole("button", { name: "Envoyer" })).toBeVisible();
  await expect(answers()).toHaveCount(2);

  await page.getByRole("button", { name: "Essayer avec…" }).click();
  await page.getByRole("menuitem", { name: /Gemini Flash$|Gemini\s+Flash$/ }).click();
  await expect(answers().last()).toContainText("Simulated answer from gemini-flash-latest");
  await expect(answers()).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Choisir le modèle" })).toContainText("Gemini");
});

test("a provider failure is explained, with a way out", async () => {
  await send("[[fail:unavailable@google]] test");
  await expect(answers().last().getByRole("alert")).toContainText("Gemini ne répond pas pour le moment");
  await expect(page.getByRole("button", { name: "Essayer avec…" })).toBeVisible();
  await shot(page, "23-chat-provider-error");
  await page.getByRole("button", { name: "Essayer avec…" }).click();
  await page.getByRole("menuitem", { name: /Sonnet 5.5/ }).click();
  await expect(answers().last()).toContainText("Simulated answer from claude-sonnet-5-5");
});

test("attachments are read on the server and sent with the message", async () => {
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes-reunion.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Compte rendu : budget 2027 validé à 12 000 €, livraison en mars."),
  });
  await expect(page.getByText("notes-reunion.txt")).toBeVisible();
  await send("Résume ce document en une phrase");
  await expect(page.getByRole("link", { name: /notes-reunion\.txt/ })).toBeVisible();
  await expect(answers().last()).toContainText("[TEST]");

  // A renamed binary file is refused before upload reaches the AI.
  await page.locator('input[type="file"]').setInputFiles({ name: "photo.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByText(/type de fichier non accepté/)).toBeVisible();
  await shot(page, "24-chat-attachment");
});

test("search finds conversations by their content", async () => {
  await page.getByRole("button", { name: /Rechercher/ }).click();
  await page.getByPlaceholder("Rechercher dans vos conversations…").fill("relance devis");
  const hit = page.getByRole("button", { name: /Rédige un e-mail de relance/ });
  await expect(hit).toBeVisible();
  await expect(hit.locator("mark").first()).toBeVisible();
  await shot(page, "25-chat-search");
  await hit.click();
  await expect(page).toHaveURL(conversationUrl);
});

test("leaving the conversation while the AI writes does not stop the answer", async () => {
  await page.goto(conversationUrl);
  const before = await answers().count();
  await composer().fill("[[slow]] Donne trois idées d'objet pour cet e-mail");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(1);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);

  await page.goto(conversationUrl);
  await expect(answers()).toHaveCount(before + 1);
  // Opened while the answer is still being written: the page refreshes itself until it is complete.
  await expect(answers().last()).toContainText("Your last message had", { timeout: 15_000 });
  await expect(page.getByText("Réponse interrompue.")).toHaveCount(0);
});

test("the Stop button stops the answer, on the server too", async () => {
  await page.goto(conversationUrl);
  const before = await answers().count();
  await composer().fill("[[slow]] Liste toutes les étapes d'un devis");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers()).toHaveCount(before + 1);
  await expect(answers().last()).toContainText("[TEST]");
  await page.getByRole("button", { name: "Arrêter la réponse" }).click();
  await expect(answers().last()).toContainText("Réponse interrompue.");
  // Saved as stopped, with only the part written before Stop.
  await page.waitForTimeout(2_000);
  await page.reload();
  await expect(answers().last()).toContainText("Réponse interrompue.");
  await expect(answers().last()).not.toContainText("Your last message had");
});

test("Stop clicked before the first word also stops the answer on the server", async () => {
  await page.goto(conversationUrl);
  const before = await answers().count();
  await composer().fill("[[slow]] Résume les étapes d'un devis");
  await page.getByRole("button", { name: "Envoyer" }).click();
  // Right away: usually before the server has started the answer (memory search, model choice).
  await page.getByRole("button", { name: "Arrêter la réponse" }).click();
  await expect(answers()).toHaveCount(before + 1);
  await expect(answers().last()).toContainText("Réponse interrompue.");
  await page.waitForTimeout(4_000);
  await page.reload();
  await expect(answers()).toHaveCount(before + 1);
  await expect(answers().last()).toContainText("Réponse interrompue.");
  await expect(answers().last()).not.toContainText("Your last message had");
});

test("a conversation can be linked to a client and is listed on the client's page", async () => {
  await page.goto("/admin/clients");
  await page.getByRole("button", { name: "Nouveau client" }).click();
  await page.getByLabel("Nom du client").fill("Boulangerie Dupont");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByText("Boulangerie Dupont").first()).toBeVisible();

  await page.goto("/chat");
  await page.getByRole("button", { name: "Rattacher à un client" }).click();
  await page.getByRole("menuitem", { name: "Boulangerie Dupont" }).click();
  await send("Prépare les points à aborder au prochain rendez-vous");
  await expect(answers().last()).toContainText("[TEST]");
  await expect(page.getByRole("link", { name: /Prépare les points à aborder/ })).toContainText("Boulangerie Dupont");

  await page.goto("/clients");
  await page.getByRole("main").getByRole("link", { name: /Boulangerie Dupont/ }).click();
  await expect(page.getByRole("main").getByRole("link", { name: /Prépare les points à aborder/ })).toBeVisible();
  await shot(page, "26-client-conversations");
});

test("the admin restricts models and sets the default", async () => {
  await page.goto("/admin/models");
  await shot(page, "27-admin-models");
  await page.getByRole("switch", { name: "Mode Auto" }).click();
  await page.getByRole("combobox", { name: "Modèle par défaut" }).click();
  await page.getByRole("option", { name: "Claude Sonnet 5.5" }).click();
  for (const name of ["Gemini Flash-Lite", "Gemini Flash", "Gemini Pro"]) await page.getByRole("switch", { name, exact: true }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages des modèles enregistrés.")).toBeVisible();

  await page.goto("/chat");
  await expect(page.getByRole("button", { name: "Choisir le modèle" })).toContainText("Sonnet 5.5");
  await page.getByRole("button", { name: "Choisir le modèle" }).click();
  await expect(page.getByRole("menuitem", { name: /Auto/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Gemini|Flash/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The server enforces it too, whatever the browser sends.
  const response = await page.request.post("/api/chat", {
    data: { conversationId: conversationUrl.split("/").pop(), modelChoice: "gemini-flash", message: { content: "x", attachmentIds: [] } },
  });
  expect(response.status()).toBe(409);
  expect(await response.json()).toEqual({ error: "model_not_allowed" });
});

test("quotas: hard stop at 100 %, enforced by the server and logged", async () => {
  await page.goto("/admin/quotas");
  await page.getByRole("button", { name: "Modifier la limite de Claire Martin" }).click();
  await page.getByRole("dialog").getByLabel("Crédits par mois").fill("0");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Limite enregistrée.")).toBeVisible();
  await shot(page, "28-admin-quotas");

  await page.goto(conversationUrl);
  await expect(page.getByRole("alert").filter({ hasText: "Vous avez atteint votre limite de crédits IA" })).toBeVisible();
  await expect(composer()).toBeDisabled();
  await shot(page, "29-chat-quota-blocked");

  const response = await page.request.post("/api/chat", {
    data: { conversationId: conversationUrl.split("/").pop(), message: { content: "Je contourne l'interface", attachmentIds: [] } },
  });
  expect(response.status()).toBe(402);
  expect(await response.json()).toEqual({ error: "quota_exceeded_user" });

  await page.goto("/admin/activity");
  await expect(page.getByText(/a été bloqué\(e\) : limite personnelle de crédits atteinte/).first()).toBeVisible();

  await page.goto("/admin/quotas");
  await page.getByRole("button", { name: "Modifier la limite de Claire Martin" }).click();
  await page.getByRole("button", { name: "Revenir à la limite par défaut" }).click();
  await expect(page.getByText("Limite enregistrée.")).toBeVisible();
});

test("the usage dashboard shows real counts per person and per model", async () => {
  await page.goto("/admin/usage");
  await expect(page.getByText("Requêtes").first()).toBeVisible();
  await expect(page.getByText("Estimation d'après les tarifs publics")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Claire Martin" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Sonnet 5.5/ })).toBeVisible();
  await shot(page, "30-admin-usage");

  await page.goto("/admin");
  await expect(page.getByText("Crédits IA ce mois-ci")).toBeVisible();
});

test("another company cannot open the conversation", async ({ browser }) => {
  const other = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(other, `chat-intruder-${run}@demo.local`);
  await other.getByLabel("Votre nom").fill("Intrus");
  await other.getByLabel("Nom de l'entreprise").fill(`Intrus ${run}`);
  await other.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(other.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  const response = await other.goto(conversationUrl);
  expect(response?.status()).toBe(404);
  const api = await other.request.post("/api/chat", {
    data: { conversationId: conversationUrl.split("/").pop(), message: { content: "x", attachmentIds: [] } },
  });
  expect(api.status()).toBe(404);
  await other.context().close();
});

test("the platform admin sees credits per company and the model catalogue, not conversations", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform");
  const row = admin.getByRole("row").filter({ hasText: company });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Ajouter des crédits" }).click();
  await admin.getByLabel("Nombre de crédits").fill("500");
  await admin.getByRole("button", { name: "Ajouter des crédits" }).last().click();
  await expect(admin.getByText("Crédits ajoutés.")).toBeVisible();
  await shot(admin, "31-platform-credits");

  await admin.goto("/platform/models");
  await expect(admin.getByText("gpt-6.1-sol")).toBeVisible();
  await shot(admin, "32-platform-models");

  expect((await admin.goto(conversationUrl))?.url()).toMatch(/\/platform$/);
  await admin.context().close();
});

test("the chat works on a phone", async ({ browser }) => {
  const phone = await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
  const mobile = await phone.newPage();
  await mobile.goto(conversationUrl);
  await expect(mobile.getByRole("textbox", { name: "Écrivez votre message…" })).toBeVisible();
  await shot(mobile, "33-mobile-chat");
  await phone.close();
});
