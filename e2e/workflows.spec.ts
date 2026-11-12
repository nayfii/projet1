import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { shot, signIn, skipAvatarStep } from "./helpers";

/**
 * Workflows in a real browser, with the simulated AI ("[TEST]"): start from a template, change it with
 * Cendr AI, test it (actions shown, never sent), turn it on after the warning, pause it.
 */
const run = Date.now().toString(36);

test.describe.configure({ mode: "serial" });
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

test("a template opens in the editor: library, canvas, Cendr AI", async () => {
  await signIn(page, `wf-owner-${run}@demo.local`);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Lumen ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Passer" }).click();
  await page.getByRole("link", { name: "Workflows" }).click();
  await expect(page.getByRole("heading", { name: "Workflows", level: 1 })).toBeVisible();
  await page.getByTestId("template-meeting_minutes").click();
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByTestId("workflow-editor")).toBeVisible();
  for (const type of ["trigger.manual", "ai.summarize", "ai.extract", "action.memory_entry"]) await expect(page.getByTestId(`node-${type}`)).toBeVisible();
  await expect(page.getByTestId("node-library")).toContainText("Chercher dans la Conscience");
  await expect(page.getByTestId("workflow-status")).toHaveText("En pause");
  await shot(page, "80-workflow-editor");
});

test("Cendr AI really edits the workflow, and undo puts it back", async () => {
  await page.getByRole("textbox", { name: "Demandez une modification…" }).fill("Ajoute une étape qui génère un e-mail de remerciement");
  await page.getByTestId("copilot").getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByTestId("node-ai.generate")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Annuler", exact: true }).first().click();
  await expect(page.getByTestId("node-ai.generate")).toHaveCount(0);
  await page.getByRole("button", { name: "Rétablir" }).click();
  await expect(page.getByTestId("node-ai.generate")).toBeVisible();
});

test("a test runs the AI steps and only shows the action", async () => {
  await page.getByRole("tab", { name: "Tester" }).click();
  await page.getByLabel("Données de test").fill("Réunion Atlas. décisions: budget validé. actions: envoyer le planning.");
  await page.getByRole("button", { name: "Lancer un test" }).click();
  const detail = page.getByTestId("run-detail");
  await expect(detail).toContainText("Réussi", { timeout: 30_000 });
  await expect(detail).toContainText("Simulé (non envoyé)");
  await expect(detail).toContainText("[TEST] Résumé");
  await shot(page, "81-workflow-test");
});

test("Play asks to fix what is missing, then warns before going live; Pause stops it", async () => {
  await page.getByTestId("play").click();
  await expect(page.getByTestId("issues")).toContainText("Réglage obligatoire manquant");
  // Choose where the minutes go (the template leaves it to the person).
  await page.getByTestId("node-action.memory_entry").click();
  const settings = page.getByTestId("settings-panel");
  await settings.getByLabel("Mémoire *").selectOption({ index: 1 });
  await expect(page.getByText("Brouillon enregistré")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("play").click();
  await expect(page.getByTestId("play-warnings")).toContainText("Créer ou modifier des données");
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByTestId("workflow-status")).toHaveText("Actif", { timeout: 10_000 });
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("workflow-status")).toHaveText("En pause", { timeout: 10_000 });
});
