import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { openSetup, shot, signIn, skipAvatarStep } from "./helpers";

/**
 * Cendr Consciousness in a real browser (the product promise): Claire tells Claude facts in a
 * conversation linked to Atlas; Cendr learns them on its server; her colleague Bruno opens a NEW
 * conversation with Gemini from Atlas's page and gets them, with their sources, without repeating
 * anything. A changed budget replaces the old one. The server must run with AI_FAKE_PROVIDER=true:
 * the models and the extraction are SIMULATED (answers labelled "[TEST]"); this proves the pipeline,
 * the permissions and the interface, not the quality of a real model.
 */
const run = Date.now().toString(36);
const owner = `cs-owner-${run}@demo.local`;
const bruno = `cs-bruno-${run}@demo.local`;
const company = `Atelier Conscience ${run}`;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let atlasUrl: string;

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
  await expect(page.getByRole("main").getByTestId("client-brief")).toContainText("Ce que Cendr sait sur Atlas");
});

test("Claire tells Claude about Atlas: Cendr learns the facts on its server and says so under the answer", async () => {
  await page.goto(atlasUrl);
  await page.getByRole("link", { name: "Nouvelle conversation avec Claude" }).click();
  await expect(page.getByTestId("learning-state")).toContainText("Apprend");
  await send(page, "Pour Atlas : le budget est de 15 000 €, lancement le 12 mars 2027. Contact principal : Jean Dupont, directeur marketing. Nous avons décidé de commencer par LinkedIn.");
  await expect(answers(page).last()).toContainText("claude");
  const learned = answers(page).last().getByTestId("memory-learned");
  await expect(learned).toHaveText(/4 faits appris/, { timeout: 20_000 });
  await learned.click();
  const panel = page.getByTestId("memory-learned-panel");
  await expect(panel).toContainText("Ajouté à la mémoire de Atlas");
  await expect(panel).toContainText("15 000");
  await expect(panel).toContainText("Jean Dupont");
  await shot(page, "c1-learned-in-claude");
});

test("Bruno opens a new Gemini conversation from Atlas: the facts are there, with their sources", async ({ browser }) => {
  const brunoContext = await browser.newContext({ locale: "fr-FR" });
  const p = await brunoContext.newPage();
  await p.goto(await latestLinkFor(bruno, new Date(0)));
  await p.getByRole("button", { name: "Accepter l'invitation" }).click();
  await p.getByLabel("Votre nom").fill("Bruno Petit");
  await p.getByRole("button", { name: "Continuer" }).click();
  await expect(p.getByRole("heading", { name: "Que puis-je faire pour vous ?" })).toBeVisible();

  // Atlas's living brief: what Claire told Claude, for Bruno, with its date.
  await p.goto(atlasUrl);
  // Scoped to the page shown: while a page streams in, a hidden copy of its content can be in the document.
  const brief = p.getByRole("main").getByTestId("client-brief");
  await expect(brief).toContainText("15 000 €");
  await expect(brief).toContainText("12 mars 2027");
  await expect(brief).toContainText("Jean Dupont");
  await shot(p, "c2-client-brief");

  await p.getByRole("link", { name: "Nouvelle conversation avec Gemini" }).click();
  await send(p, "Rédige le mail d'annonce du lancement pour Atlas.");
  const answer = answers(p).last();
  await expect(answer).toContainText("gemini");
  // The simulated model shows what it received: the four key facts of Atlas.
  await expect(answer).toContainText("Knowledge passages received: 4");
  const used = answer.getByTestId("memory-used");
  await expect(used).toHaveText(/4 mémoires utilisées/);
  await used.click();
  const panel = p.getByTestId("memory-used-panel");
  await expect(panel).toContainText("Faits clés du client (toujours transmis)");
  await expect(panel).toContainText("15 000");
  await shot(p, "c3-gemini-uses-memory");

  // Claire changes the budget (with Claude); Bruno's next answer has the new one only.
  await page.bringToFront();
  await send(page, "Mise à jour : le budget d'Atlas passe à 18 000 €.");
  await expect(answers(page).last().getByTestId("memory-learned")).toHaveText(/1 fait appris/, { timeout: 20_000 });

  await p.bringToFront();
  await send(p, "Et quel est le budget maintenant ?");
  await answers(p).last().getByTestId("memory-used").click();
  const latest = answers(p).last().getByTestId("memory-used-panel");
  await expect(latest).toContainText("18 000");
  await expect(latest).not.toContainText("15 000");
  await p.goto(atlasUrl);
  await expect(p.getByRole("main").getByTestId("client-brief")).toContainText("Changements récents");
  await shot(p, "c4-budget-changed");
  await brunoContext.close();
});

test("the Consciousness hub shows real counts and the recent learning", async () => {
  await page.goto("/memory");
  await expect(page.getByRole("heading", { name: "Conscience" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByTestId("consciousness-stats")).toContainText("Appris cette semaine");
  await expect(main.getByTestId("consciousness-activity")).toContainText("Budget");
  await shot(page, "c5-hub");
});
