import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { shot, signIn } from "./helpers";

/**
 * Step 6, Confronter (CLAUDE.md §4.5): cost shown before running, three models answer, critique each
 * other, then a synthesis; it goes through Hide like any request. AI_FAKE_PROVIDER=true.
 */
const run = Date.now().toString(36);
const owner = `confront-owner-${run}@demo.local`;
const IBAN = "FR76 3000 6000 0112 3456 7890 189";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR" });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

const answers = () => page.locator("article");

test("Confronter: the cost is shown first, then three answers, critiques and a synthesis", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Atelier Confronter ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await page.goto("/chat");

  await page.getByRole("textbox", { name: "Écrivez votre message…" }).fill(`Faut-il payer la facture sur ${IBAN} avant vendredi ?`);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers()).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });

  await answers().last().getByRole("button", { name: "Confronter" }).click();
  const dialog = page.getByRole("dialog", { name: "Confronter" });
  for (const brand of ["ChatGPT", "Claude", "Gemini"]) await expect(dialog).toContainText(brand);
  await expect(dialog).toContainText(/Coût estimé : environ \d+ crédits/);
  await expect(dialog).toContainText(/fois une question normale/);
  await shot(page, "71-confront-cost");
  await dialog.getByRole("button", { name: /^Lancer/ }).click();

  const card = page.getByRole("region", { name: "Confronter" });
  await expect(card).toContainText("Points d'accord", { timeout: 30_000 });
  await expect(card).toContainText("agree on the main point");
  await expect(card).toContainText("Divergences");
  await expect(card).toContainText("Erreurs ou raisonnements faibles");
  await expect(card).toContainText("À vérifier");
  await expect(card).toContainText("Réponse recommandée");
  // Hide: the models only saw [IBAN_1]; people see the real value again.
  await expect(card).toContainText(IBAN);
  await expect(card).toContainText(/\d+ crédits utilisés/);
  await shot(page, "72-confront-synthesis");

  await card.getByRole("tab", { name: "Réponses (3)" }).click();
  await expect(card.getByText(/Simulated answer from/)).toHaveCount(3);
  await expect(card).toContainText("Last message as received: «Faut-il payer la facture sur");
  await shot(page, "73-confront-answers");
  await card.getByRole("tab", { name: "Critiques (3)" }).click();
  await expect(card.getByText(/\[TEST\] Critique of/)).toHaveCount(3);
  await shot(page, "74-confront-critiques");

  // Saved with the conversation.
  await page.reload();
  await expect(page.getByRole("region", { name: "Confronter" })).toContainText("Réponse recommandée");
});
