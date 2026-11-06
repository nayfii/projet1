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
  await expect(page.getByTestId("dictation-bar")).toBeVisible();
  await expect(page.title()).resolves.toContain("Dictée en cours");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Envoyer directement" }).click();
  await expect(answers()).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(answers().last()).toContainText("Ceci est une dictée de démonstration");
  await expect(page.title()).resolves.not.toContain("Dictée en cours");
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
});
