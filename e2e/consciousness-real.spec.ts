import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { openSetup, shot, signIn, skipAvatarStep } from "./helpers";

/**
 * Cendr Consciousness with REAL models (run on demand: `E2E_REAL_AI=1`, against a server started
 * WITHOUT AI_FAKE_PROVIDER and with provider keys). Same story as e2e/consciousness.spec.ts, but a
 * real model answers and a real model reads the exchange to extract the facts: this checks the
 * quality of the extraction and that a colleague's new conversation really uses what was learned
 * (and does not invent what was never said). Uses the first assistant offered on the client's page
 * for each step (`E2E_REAL_FIRST` / `E2E_REAL_SECOND` pick another one: Claude, ChatGPT or Gemini).
 */
test.skip(!process.env.E2E_REAL_AI, "real models: run with E2E_REAL_AI=1 against a server without AI_FAKE_PROVIDER");

const run = Date.now().toString(36);
const owner = `real-owner-${run}@demo.local`;
const bruno = `real-bruno-${run}@demo.local`;
const company = `Atelier Réel ${run}`;
const FIRST = process.env.E2E_REAL_FIRST ?? "ChatGPT";
const SECOND = process.env.E2E_REAL_SECOND ?? "ChatGPT";
/** A real model and a real extraction take longer than the simulated ones. */
const SLOW = 90_000;

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

let context: BrowserContext;
let page: Page;
let atlasUrl: string;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR" });
  page = await context.newPage();
});
test.afterAll(async () => context?.close());

const answers = (p: Page) => p.locator("article");
/** "15 000", "15 000" (narrow space), "15000" or "15.000". */
const amount = (thousands: number) => new RegExp(`${thousands}[\\s\\u202f\\u00a0.]?000`);

async function send(p: Page, text: string) {
  const before = await answers(p).count();
  await p.getByRole("textbox", { name: "Écrivez votre message…" }).fill(text);
  await p.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers(p)).toHaveCount(before + 1, { timeout: SLOW });
  await expect(p.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: SLOW });
}

test("Claire sets up her company, invites Bruno and adds the client Atlas", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(company);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Continuer" }).click();

  await openSetup(page, "invite");
  await page.getByLabel("Adresses e-mail").fill(bruno);
  await page.getByRole("button", { name: "Envoyer les invitations" }).click();
  await expect(page.getByText("E-mail envoyé")).toHaveCount(1);
  await page.getByRole("button", { name: "Continuer" }).click();

  await openSetup(page, "client");
  await page.getByLabel("Nom du client").fill("Atlas");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await page.waitForURL((url) => url.pathname !== "/onboarding");
  await page.goto("/clients");
  await page.getByRole("main").getByRole("link", { name: /Atlas/ }).first().click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  atlasUrl = page.url();
});

test(`Claire tells ${FIRST} about Atlas: a real model extracts the facts`, async () => {
  await page.goto(atlasUrl);
  await page.getByRole("link", { name: `Nouvelle conversation avec ${FIRST}` }).click();
  await send(
    page,
    "Pour Atlas : le budget est de 15 000 €, lancement le 12 mars 2027. Contact principal : Jean Dupont, directeur marketing. Nous avons décidé de commencer par LinkedIn. Peux-tu me confirmer que c'est noté ?",
  );
  const learned = answers(page).last().getByTestId("memory-learned");
  await expect(learned).toHaveText(/\d+ faits? appris/, { timeout: SLOW });
  await learned.click();
  const panel = page.getByTestId("memory-learned-panel");
  await expect(panel).toContainText(amount(15));
  await expect(panel).toContainText("Jean Dupont");
  await expect(panel).toContainText(/mars 2027|2027-03-12|12\/03\/2027/);
  await shot(page, "real-1-learned");
});

test(`Bruno asks ${SECOND} in a new conversation: the answer uses what Claire said, with its sources`, async ({ browser }) => {
  const brunoContext = await browser.newContext({ locale: "fr-FR" });
  const p = await brunoContext.newPage();
  await p.goto(await latestLinkFor(bruno, new Date(0)));
  await p.getByRole("button", { name: "Accepter l'invitation" }).click();
  await p.getByLabel("Votre nom").fill("Bruno Petit");
  await p.getByRole("button", { name: "Continuer" }).click();
  await expect(p.getByRole("heading", { name: "Que puis-je faire pour vous ?" })).toBeVisible();

  await p.goto(atlasUrl);
  const brief = p.getByTestId("client-brief");
  await expect(brief).toContainText(amount(15));
  await expect(brief).toContainText("Jean Dupont");

  await p.getByRole("link", { name: `Nouvelle conversation avec ${SECOND}` }).click();
  await send(p, "Rappelle-moi le budget d'Atlas, la date de lancement et qui est notre contact.");
  const answer = answers(p).last();
  await expect(answer).toContainText(amount(15));
  await expect(answer).toContainText(/12 mars|12\/03/);
  await expect(answer).toContainText("Jean Dupont");
  await expect(answer.getByTestId("memory-used")).toHaveText(/\d+ mémoires? utilisées?/);
  await shot(p, "real-2-colleague-recalls");

  // Never said: a real model must not make it up (no SIRET-like number in the answer).
  await send(p, "Quel est le numéro de SIRET d'Atlas ?");
  await expect(answers(p).last()).not.toContainText(/\b\d{3}\s?\d{3}\s?\d{3}(\s?\d{5})?\b/);
  await shot(p, "real-3-does-not-invent");

  // Claire changes the budget; the real extraction replaces the old value and Bruno gets the new one.
  await page.bringToFront();
  await send(page, "Mise à jour importante : le budget d'Atlas passe à 18 000 €.");
  await expect(answers(page).last().getByTestId("memory-learned")).toHaveText(/\d+ faits? appris/, { timeout: SLOW });

  await p.bringToFront();
  await send(p, "Et quel est le budget d'Atlas maintenant ?");
  const latest = answers(p).last();
  await expect(latest).toContainText(amount(18));
  // The budget changed: the earlier answer was right at the time, not a mistake (found with a real model).
  await expect(latest).not.toContainText(/par erreur|une erreur|mistake/i);
  await latest.getByTestId("memory-used").click();
  const used = latest.getByTestId("memory-used-panel");
  await expect(used).toContainText(amount(18));
  await expect(used).not.toContainText(amount(15));
  await shot(p, "real-4-budget-changed");
  await brunoContext.close();
});
