import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { shot, signIn, skipAvatarStep } from "./helpers";
import { chatgptZip } from "../tests/helpers/exports";

/**
 * Knowledge import (CLAUDE.md §12) in a real browser: from onboarding, a SYNTHETIC ChatGPT export
 * (work mixed with health, love life, a password and a salary) is read in the browser, analysed with the
 * simulated AI ("[TEST]"), reviewed and saved. Nothing private reaches the review.
 * The server must run with AI_FAKE_PROVIDER=true.
 */
const run = Date.now().toString(36);
const owner = `import-owner-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR" });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

test("onboarding offers the import; the page explains privacy and keeps a slot for the tutorial", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Lumen ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await page.getByRole("button", { name: /Importez vos connaissances/ }).click();
  await expect(page).toHaveURL(/\/memory\/import\?from=onboarding/);
  await expect(page.getByRole("heading", { name: "Enrichir mes connaissances" })).toBeVisible();
  await expect(page.getByText("Tutoriel vidéo bientôt disponible")).toBeVisible();
  // No fake play button in the placeholder.
  await expect(page.getByTestId("import-tutorial").getByRole("button")).toHaveCount(0);
  await expect(page.getByText("Vos connaissances, pas votre vie privée.")).toBeVisible();
  await page.getByRole("radio", { name: "ChatGPT" }).click();
  await expect(page.getByTestId("export-guide")).toContainText("Exporter les données");
  await shot(page, "60-import-start");
});

test("the export is read in the browser, analysed, and nothing private reaches the review", async () => {
  await page.getByTestId("import-input").setInputFiles({ name: "chatgpt-export.zip", mimeType: "application/zip", buffer: Buffer.from(chatgptZip()) });
  await expect(page.getByText("Export ChatGPT reconnu")).toBeVisible();
  await expect(page.getByText("5 éléments trouvés")).toBeVisible();
  await page.getByRole("button", { name: "Analyser" }).click();
  await expect(page.getByTestId("import-review")).toBeVisible({ timeout: 30_000 });
  const review = page.getByTestId("import-review");
  await expect(review).toContainText("chaque devis est relu par un associé");
  for (const privateText of ["médecin", "anxiété", "copain", "Sup3rS3cret", "salaire", "crédit immobilier"]) await expect(review).not.toContainText(privateText);
  await expect(page.getByRole("heading", { name: "Pour vous seul" })).toBeVisible();
  await shot(page, "61-import-review");
});

test("the person keeps a preference for themselves and shares a rule with the company", async () => {
  const rule = page.getByTestId("import-proposal").filter({ hasText: "chaque devis est relu" });
  await expect(rule.getByRole("checkbox")).not.toBeChecked();
  await expect(rule).toContainText("Visible selon les droits de la mémoire de l'entreprise");
  await rule.getByRole("checkbox").check();
  const preference = page.getByTestId("import-proposal").filter({ hasText: "Je préfère des réponses courtes" });
  await expect(preference.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: /^Enregistrer \d+ connaissances?$/ }).click();
  await expect(page.getByText(/connaissances? enregistrées?\./)).toBeVisible();
  await expect(page.getByTestId("import-history")).toContainText("Terminé");
  await expect(page.getByTestId("import-summary").first()).toContainText("écartés car privés");
  await shot(page, "62-import-done");

  await page.goto("/profile");
  await expect(page.locator("#personal-memory").locator("..")).toContainText("Je préfère des réponses courtes");
  await page.goto("/memory");
  await expect(page.getByRole("link", { name: /Mémoire de l'entreprise/ })).toContainText("1 entrée");
  // Once imported, the home page no longer suggests it.
  await page.goto("/");
  await expect(page.getByTestId("home-import")).toHaveCount(0);
});

test("a broken file gets a plain explanation", async () => {
  await page.goto("/memory/import");
  await page.getByTestId("import-input").setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: Buffer.from("this is not a zip") });
  await expect(page.getByRole("alert").filter({ hasText: "Ce fichier" })).toContainText("Ce fichier est abîmé");
});
