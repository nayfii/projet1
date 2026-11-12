import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signIn, skipAvatarStep } from "./helpers";

/**
 * The chat at ChatGPT level (founder's quick-fix list): ready-to-send blocks, editing an earlier
 * prompt, the sidebar's rename / pin / archive, drafts kept per conversation, the answer status in the
 * sidebar, and dictation sent straight from the recording bar. Simulated provider (AI_FAKE_PROVIDER).
 */
const run = Date.now().toString(36);
const owner = `ux-owner-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR", permissions: ["clipboard-read", "clipboard-write", "microphone"] });
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

const answers = () => page.locator("article");
const composer = () => page.getByRole("textbox", { name: "Écrivez votre message…" });

async function send(text: string) {
  const before = await answers().count();
  await composer().fill(text);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers()).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

test("an email asked for comes as a card to edit and copy", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Inès Roy");
  await page.getByLabel("Nom de l'entreprise").fill(`Atelier UX ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Continuer" }).click();

  await page.goto("/chat");
  await send("Écris l'e-mail d'annonce du lancement [[email]]");
  const block = answers().last().getByTestId("copy-block");
  await expect(block).toContainText("E-mail");
  await expect(block.getByRole("textbox")).toHaveValue(/Objet : \[TEST\] Lancement/);
  await block.getByRole("textbox").fill("Objet : Lancement\n\nBonjour à tous,");
  await expect(block).toContainText("modifié");
  await block.getByRole("button", { name: "Copier" }).click();
  await expect(block.getByRole("button", { name: "Copié" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Objet : Lancement\n\nBonjour à tous,");
});

test("an earlier prompt is edited and run again; the old answer goes", async () => {
  await send("Deuxième question");
  await expect(answers()).toHaveCount(2);
  const first = page.getByTestId("my-message").first();
  await first.hover();
  await first.getByRole("button", { name: "Modifier" }).click();
  const editor = page.getByRole("textbox", { name: "Modifier" });
  await editor.fill("Écris plutôt un message court");
  await page.getByRole("button", { name: "Renvoyer" }).click();
  await expect(answers()).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(answers().last()).toContainText("Écris plutôt un message court");
  await expect(page.getByTestId("my-message").filter({ hasText: "Deuxième question" })).toHaveCount(0);
  // After a reload too: the server set them aside.
  await page.reload();
  await expect(page.getByTestId("my-message").filter({ hasText: "Deuxième question" })).toHaveCount(0);
  await expect(answers()).toHaveCount(1);
});

test("a double-click on the title renames the conversation; Échap cancels", async () => {
  const title = () => page.locator('h1[title="Double-cliquez pour renommer"]');
  await title().dblclick();
  const field = page.getByRole("textbox", { name: "Renommer la conversation" });
  await expect(field).toBeFocused();
  await field.fill("Titre à oublier");
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(title()).not.toContainText("Titre à oublier");

  await title().dblclick();
  await page.getByRole("textbox", { name: "Renommer la conversation" }).fill("Plan de lancement");
  await page.getByRole("textbox", { name: "Renommer la conversation" }).press("Enter");
  await expect(title()).toContainText("Plan de lancement");
  await expect(page.getByTestId("conversation-row").first()).toContainText("Plan de lancement");
  await page.reload();
  await expect(title()).toContainText("Plan de lancement");
});

test("the sidebar: rename, pin, archive, with each change kept", async () => {
  const row = page.getByTestId("conversation-row").first();
  await row.hover();
  await row.getByRole("button", { name: /Options de/ }).click();
  await page.getByRole("menuitem", { name: "Renommer" }).click();
  const input = page.getByRole("textbox", { name: "Renommer" });
  await input.fill("Annonce lancement");
  await input.press("Enter");
  await expect(page.getByTestId("conversation-row").first()).toContainText("Annonce lancement");

  await page.getByTestId("conversation-row").first().hover();
  await page.getByTestId("conversation-row").first().getByRole("button", { name: /Options de/ }).click();
  await page.getByRole("menuitem", { name: "Épingler" }).click();
  await expect(page.getByText("Épinglées")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Épinglées")).toBeVisible();

  await page.getByTestId("conversation-row").first().hover();
  await page.getByTestId("conversation-row").first().getByRole("button", { name: /Options de/ }).click();
  await page.getByRole("menuitem", { name: "Archiver" }).click();
  await expect(page.getByText("Conversation archivée.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Archivée \(1\)/ })).toBeVisible();
});

test("a draft stays with its conversation", async () => {
  await page.goto("/chat");
  await composer().fill("Un brouillon à garder");
  await page.waitForTimeout(600);
  await page.goto("/memory");
  await page.goto("/chat");
  await expect(composer()).toHaveValue("Un brouillon à garder");
});

test("dictation sent with the arrow goes out at once; the recording bar shows the level and the time", async () => {
  await composer().fill("");
  await page.getByRole("button", { name: "Dicter" }).click();
  // The bar shows at once; the tab says so once the microphone really listens.
  await expect(page.getByTestId("dictation-bar")).toHaveAttribute("aria-label", "Enregistrement en cours");
  await expect.poll(() => page.title()).toContain("Dictée en cours");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Envoyer directement" }).click();
  await expect(answers()).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(answers().last()).toContainText("Ceci est une dictée de démonstration");
  await expect(page.title()).resolves.not.toContain("Dictée en cours");
});

test("an app's long field takes dictation: the text is added for review, the form is not sent", async () => {
  await page.goto("/apps");
  await page.getByRole("main").getByText("Préparation de rendez-vous").first().click();
  const goal = page.getByLabel("Objectif du rendez-vous *");
  await goal.fill("Point budget.");
  await page.getByRole("main").getByRole("button", { name: "Dicter" }).click();
  await expect(page.getByTestId("dictation-bar")).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Terminer et transcrire" }).click();
  await expect(goal).toHaveValue(/^Point budget\. Ceci est une dictée de démonstration/, { timeout: 20_000 });
  await expect(page).toHaveURL(/\/apps\//);
});

test("dictation is made ready to read (hesitations out), and the original can come back", async () => {
  await page.goto("/chat");
  await composer().fill("");
  await page.getByRole("button", { name: "Dicter" }).click();
  await expect(page.getByTestId("dictation-bar")).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Terminer et transcrire" }).click();
  // Test mode transcribes "Euh, ceci est…": the hesitation is gone in the message box.
  await expect(composer()).toHaveValue("Ceci est une dictée de démonstration (mode test).", { timeout: 20_000 });
  await page.getByRole("button", { name: "Voir l'original" }).click();
  await expect(composer()).toHaveValue("Euh, ceci est une dictée de démonstration (mode test).");
  // The cleanup service alone: hesitations and words said twice go, nothing is added.
  const cleaned = await page.request.post("/api/dictation/clean", { data: { text: "euh le le devis est prêt", locale: "fr" } });
  expect(await cleaned.json()).toEqual({ ok: true, text: "Le devis est prêt", polished: false });
  await composer().fill("");
});

test("holding Ctrl + Shift + Space dictates while held, and the text appears while the person talks", async () => {
  test.setTimeout(90_000);
  await expect(page.getByRole("button", { name: "Dicter" })).toHaveAttribute("aria-keyshortcuts", "Control+Shift+Space");
  await composer().click();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.down("Space");
  await expect(page.getByTestId("dictation-bar")).toBeVisible();
  // A long dictation is cut at a pause (at the latest after about 15 s) and each part transcribed at
  // once: the first part shows under the message box before the person has finished.
  await expect(page.getByTestId("dictation-live")).toContainText("ceci est une dictée", { timeout: 40_000 });
  await expect(page.getByTestId("dictation-bar")).toBeVisible();
  await page.keyboard.up("Space");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await expect(page.getByTestId("dictation-bar")).toBeHidden();
  await expect(composer()).toHaveValue(/^Ceci est une dictée de démonstration \(mode test\)\./, { timeout: 20_000 });
  await expect(page.getByTestId("dictation-live")).toBeHidden();
  // Nothing typed by the shortcut itself, nothing sent.
  expect(await composer().inputValue()).not.toContain("  ");
  await composer().fill("");
});

test("a quick press of the shortcut keeps the microphone on until it is pressed again; Échap cancels", async () => {
  await composer().click();
  await page.keyboard.press("Control+Shift+Space");
  await expect(page.getByTestId("dictation-bar")).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("dictation-bar")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dictation-bar")).toBeHidden();
  await expect(composer()).toHaveValue("");
  await page.keyboard.press("Control+Shift+Space");
  await expect(page.getByTestId("dictation-bar")).toBeVisible();
  await page.waitForTimeout(1200);
  await page.keyboard.press("Control+Shift+Space");
  await expect(composer()).toHaveValue("Ceci est une dictée de démonstration (mode test).", { timeout: 20_000 });
  await composer().fill("");
});

test("an image is created from a request, and the Image button forces one", async () => {
  await page.goto("/chat");
  await send("Crée une image d'un vélo rouge sur fond blanc");
  const first = answers().last();
  await expect(first.getByTestId("generated-images").locator("img")).toBeVisible();
  await expect(first).toContainText("Image simulée");
  await expect(first.locator("header")).toContainText("Images");
  // The Image button forces an image for any text.
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await send("un coucher de soleil sur Paris");
  await expect(answers().last().getByTestId("generated-images").locator("img")).toBeVisible();
  // An image stays in the conversation: the workspace on the right does not open for it.
  await expect(page.getByTestId("artifact-panel")).toHaveCount(0);
});

test("a document opens in the workspace on the right: download, edit by hand, new version by the AI", async () => {
  await page.goto("/chat");
  await send("Prépare la facture [[invoice]]");
  const panel = page.getByTestId("artifact-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("[TEST] Facture — Boulangerie Martin");
  await expect(panel).toContainText("Facture n° 2026-042");
  await expect(panel).toContainText("1200");
  const card = answers().last().getByTestId("artifact-card");
  await expect(card).toContainText("Document · version 1");

  // Downloads: PDF and Word, built on our server from the document only.
  for (const [label, extension] of [["PDF", ".pdf"], ["Word (.docx)", ".docx"]] as const) {
    await panel.getByRole("button", { name: "Télécharger" }).click();
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
    expect(file.suggestedFilename()).toMatch(new RegExp(`facture-boulangerie-martin\\${extension}$`));
  }

  // Edited by hand: a new version, posted to the conversation (no AI answer), shown at once.
  await panel.getByRole("button", { name: "Modifier" }).click();
  const editor = panel.getByRole("textbox", { name: "Modifier" });
  await editor.fill((await editor.inputValue()).replace("| 2 | 600 | 1200 |", "| 2 | 600 | 999 |"));
  const before = await answers().count();
  await panel.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Nouvelle version enregistrée.")).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Versions" })).toHaveValue("2");
  await expect(panel).toContainText("999");
  await expect(answers()).toHaveCount(before);

  // Closed, then opened again from the card.
  await panel.getByRole("button", { name: "Fermer l'espace de travail" }).click();
  await expect(panel).toHaveCount(0);
  await card.click();
  await expect(panel).toBeVisible();

  // The AI changes it: same document, version 3.
  await send("Passe à 3 ateliers [[revise]]");
  await expect(panel.getByRole("combobox", { name: "Versions" })).toHaveValue("3");
  await expect(panel).toContainText("1800");
  await panel.getByRole("combobox", { name: "Versions" }).selectOption("1");
  await expect(panel).toContainText("Version 1 sur 3");
  await expect(panel).toContainText("1200");
  await page.reload();
  await expect(answers().last().getByTestId("artifact-card")).toContainText("version 3");
});

test("slides and a spreadsheet get their own views", async () => {
  await send("Fais une présentation du lancement [[slides]]");
  const panel = page.getByTestId("artifact-panel");
  await expect(panel.getByTestId("artifact-slide")).toContainText("Lancement du produit");
  await expect(panel).toContainText("1 / 2");
  await panel.getByRole("button", { name: "Diapositive suivante" }).click();
  await expect(panel.getByTestId("artifact-slide")).toContainText("Calendrier");

  await send("Fais le tableau du budget [[sheet]]");
  await expect(panel.getByRole("table")).toContainText("Publicité");
  await panel.getByRole("button", { name: "Modifier" }).click();
  await panel.getByRole("textbox", { name: "Cellule ligne 1, colonne 2" }).fill("1300");
  await panel.getByRole("button", { name: "Enregistrer" }).click();
  await expect(panel.getByRole("combobox", { name: "Versions" })).toHaveValue("2");
  await expect(panel.getByRole("table")).toContainText("1300");
  await panel.getByRole("button", { name: "Télécharger" }).click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Excel (.xlsx)" }).click()]);
  expect(file.suggestedFilename()).toMatch(/budget-trimestriel\.xlsx$/);
});

test("@Albert prepares a meeting or writes its minutes with the meeting apps, in the conversation", async () => {
  await page.goto("/chat");
  await composer().fill("@Alb");
  const option = page.getByRole("option", { name: /@Albert/ });
  await expect(option).toContainText("Réunions");
  await option.click();
  await expect(composer()).toHaveValue("@Albert ");
  await send("@Albert prépare mon rendez-vous de demain avec la Boulangerie Martin");
  await expect(answers().last()).toContainText("Tool instructions received: Meeting Prep");
  await send("@Albert fais le compte rendu de ces notes : budget validé, lancement en mars");
  await expect(answers().last()).toContainText("Tool instructions received: Meeting Minutes");
});

test("'/' offers to create a document, a presentation or a spreadsheet right here", async () => {
  await composer().fill("/pres");
  const shortcut = page.getByRole("option", { name: /Une présentation/ });
  await expect(shortcut).toBeVisible();
  await shortcut.click();
  await expect(composer()).toHaveValue("Crée une présentation sur ");
});

