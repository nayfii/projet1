import { test, expect, type Page } from "@playwright/test";
import { shot, signIn, skipAvatarStep } from "./helpers";

/**
 * Step 13 and the chat improvements (CLAUDE.md §11, founder's requests of 2026-11-03): the home
 * checklist, Applis (picker in the chat, favourites, our team's apps and launch switches), natural
 * mentions alone with the AI, automatic titles, web search with sources, PDFs, the Hide menu, the new
 * robots, and sign-up by invitation only. The server runs with AI_FAKE_PROVIDER=true.
 */
const run = Date.now().toString(36);
const owner = `s13-owner-${run}@demo.local`;
const company = `Atelier Treize ${run}`;
const appName = `Appli Cendr ${run}`;

test.describe.configure({ mode: "serial" });
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
});

const composer = () => page.getByRole("textbox", { name: "Écrivez votre message…" });
const answers = () => page.locator("article");

async function waitForAnswer(before: number) {
  await expect(answers()).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

test("onboarding: name, company, avatar, profile, then straight into the first conversation; the rest is a checklist", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(company);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "Que puis-je faire pour vous ?" })).toBeVisible();

  await page.goto("/");
  const checklist = page.getByTestId("setup-checklist");
  await expect(checklist).toContainText("Pour bien démarrer · 0/3");
  await expect(checklist.getByRole("link", { name: "Ajoutez un premier client" })).toBeVisible();
  await shot(page, "s13-01-home-checklist");
  await checklist.getByRole("link", { name: "Ajoutez un premier client" }).click();
  await page.getByLabel("Nom du client").fill("Client A");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("setup-checklist")).toContainText("1/3");
});

test("our console: launch switches and an app for every customer", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform/apps");
  await expect(admin.getByRole("switch", { name: "Applis vidéo (Motion Design, Montage vidéo)" })).toBeVisible();
  await expect(admin.getByRole("switch", { name: "Assistant de tri des candidatures" })).not.toBeChecked();
  await admin.getByRole("button", { name: "Nouvelle appli" }).click();
  const dialog = admin.getByRole("dialog", { name: "Nouvelle appli" });
  await dialog.getByLabel("Nom", { exact: true }).fill(appName);
  await dialog.getByLabel("Instructions pour l'IA").fill("Résume la demande en trois points et propose une prochaine étape.");
  await shot(admin, "s13-02-platform-app");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(admin.getByText("Appli enregistrée")).toBeVisible();
  await expect(admin.getByTestId("platform-app").filter({ hasText: appName })).toBeVisible();
  await shot(admin, "s13-03-platform-apps");
  await admin.context().close();
});

test("Applis: shelves by department, our app, favourites", async () => {
  await page.goto("/apps");
  await expect(page.getByRole("region", { name: "Ventes" }).getByRole("link", { name: /Proposition commerciale/ })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(appName) })).toBeVisible();
  // The Application Review Assistant stays hidden until a lawyer has reviewed it.
  await expect(page.getByRole("link", { name: /Aide à la lecture de candidatures/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Ajouter Proposition commerciale à vos applis" }).click();
  await page.getByRole("tab", { name: "Vos applis" }).click();
  await expect(page.getByRole("link", { name: /Proposition commerciale/ })).toBeVisible();
  await shot(page, "s13-04-apps");
});

test("in the chat, \"/\" opens the apps; Enter opens the one chosen", async () => {
  await page.goto("/chat");
  await composer().click();
  await composer().pressSequentially("/propo");
  const menu = page.getByRole("listbox", { name: "Applis" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option").first()).toContainText("Proposition commerciale");
  await shot(page, "s13-05-slash-apps");
  await composer().press("Enter");
  await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Proposition commerciale" })).toBeVisible();
});

test("\"Coucou Claude\" hands the turn to Claude, searches the web and gives the conversation a title", async () => {
  await page.goto("/chat");
  await composer().fill("Coucou Claude, quelles sont les actualités du jour ? [[web]]");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswer(0);
  const answer = answers().last();
  // The message became a mention, Claude answered (the test model names itself), with its sources.
  await expect(page.locator(".group\\/user").last()).toContainText("Coucou @Claude, quelles sont les actualités");
  await expect(answer).toContainText(/Simulated answer from \*?\*?claude/i);
  await expect(answer.getByTestId("web-sources")).toContainText("[TEST] Une actualité");
  await expect(answer.getByTestId("web-sources").getByRole("link")).toHaveAttribute("href", "https://example.com/actualite");
  // The automatic title (written by the test model) replaces the first words in the sidebar.
  await expect(page.getByRole("link", { name: /\[TEST\] Coucou @Claude, quelles sont/ })).toBeVisible({ timeout: 10_000 });
  await shot(page, "s13-06-claude-web-title");
});

test("a PDF asked in the chat: the answer says so and a download button gives the file", async () => {
  await composer().fill("Fais-moi un PDF de présentation de l'atelier.");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswer(1);
  const button = answers().last().getByRole("link", { name: "Télécharger le PDF" });
  await expect(button).toBeVisible();
  const download = await page.request.get((await button.getAttribute("href"))!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("application/pdf");
});

test("Hide: one switch, and its three modes in a small menu", async () => {
  await page.goto("/chat");
  await expect(page.getByRole("switch", { name: "Masquage auto" })).toBeChecked();
  await page.getByRole("button", { name: "Ce que Hide protège" }).click();
  const menu = page.getByRole("menu");
  for (const mode of ["Le message", "Les fichiers joints", "Manuel"]) await expect(menu.getByRole("menuitemcheckbox", { name: new RegExp(mode) })).toBeChecked();
  await shot(page, "s13-07-hide-menu");
  await page.keyboard.press("Escape");
});

test("the assistants are the glossy robots, with a live face", async () => {
  await page.goto("/chat");
  const robot = page.locator('[data-assistant="anthropic"]').first();
  await expect(robot.locator("img")).toHaveAttribute("src", "/avatars/assistants/anthropic.png");
  await expect(robot.locator(".assistant-eye")).toHaveCount(2);
});

test("sign-up by invitation only: without an invitation, nobody creates a company", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform/companies");
  const open = admin.getByRole("switch", { name: "Inscription libre" });
  await open.click();
  await expect(open).not.toBeChecked();
  try {
    const stranger = await (await browser.newContext({ locale: "fr-FR" })).newPage();
    await signIn(stranger, `s13-stranger-${run}@demo.local`);
    await expect(stranger.getByRole("heading", { name: "Cendr est sur invitation" })).toBeVisible();
    await expect(stranger.getByLabel("Nom de l'entreprise")).toHaveCount(0);
    await shot(stranger, "s13-08-invite-only");
    await stranger.context().close();
  } finally {
    // The other specs create their own companies.
    await admin.goto("/platform/companies");
    await admin.getByRole("switch", { name: "Inscription libre" }).click();
    await expect(admin.getByRole("switch", { name: "Inscription libre" })).toBeChecked();
    await admin.context().close();
  }
});
