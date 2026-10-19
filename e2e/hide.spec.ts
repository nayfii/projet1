import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { shot, signIn } from "./helpers";

/**
 * Hide, as validated with the founder: red = the AI would see it, green struck = protected.
 * "Masquage auto" (on by default) protects what is detected; a click switches an item; files follow
 * the same rule in a preview. The server must run with AI_FAKE_PROVIDER=true: the simulated model
 * repeats the last message exactly as it received it.
 */
const run = Date.now().toString(36);
const owner = `hide-owner-${run}@demo.local`;
const IBAN = "FR76 3000 6000 0112 3456 7890 189";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR" });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

const composer = () => page.getByRole("textbox", { name: "Écrivez votre message…" });
const answers = () => page.locator("article");
const userMessages = () => page.locator(".group\\/user");
const item = (text: string) => page.locator("[data-hide]", { hasText: text }).first();

async function clickItem(text: string) {
  const box = (await item(text).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function send(text: string) {
  const before = await answers().count();
  await composer().fill(text);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers()).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

test("auto-protect (default): detected items arrive struck in green; a click leaves one visible in red", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Atelier Hide ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Ajoutez un premier client" })).toBeVisible();
  await page.getByLabel("Nom du client").fill("Client A");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByRole("heading", { name: "Votre premier document" })).toBeVisible();

  await page.goto("/chat");
  await expect(page.getByRole("switch", { name: "Masquage auto" })).toBeChecked();
  await composer().fill(`Verse 1 200 € sur ${IBAN} pour Client A, merci à Jean Dupont.`);
  await expect(page.getByText("3 éléments protégés : l’IA ne les verra pas")).toBeVisible();
  for (const text of ["FR76", "Client A", "Jean Dupont"]) await expect(item(text)).toHaveAttribute("data-hide", "protected");
  await shot(page, "50-hide-auto");

  // A click leaves an item visible to the AI (red)… and a second click protects it again.
  await clickItem("Jean Dupont");
  await expect(item("Jean Dupont")).toHaveAttribute("data-hide", "visible");
  await expect(page.getByText("2 protégés, 1 visible par l’IA")).toBeVisible();
  await shot(page, "51-hide-left-visible");
  await clickItem("Jean Dupont");
  await expect(item("Jean Dupont")).toHaveAttribute("data-hide", "protected");

  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(answers()).toHaveCount(1);

  // The sent message shows the protected values struck in green; the AI received placeholders.
  const message = userMessages().last();
  await expect(message.locator(".line-through", { hasText: IBAN })).toBeVisible();
  await expect(message).toContainText("3 éléments protégés");
  await message.getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(message).toContainText("Verse 1 200 € sur [IBAN_1] pour [CLIENT_1], merci à [PERSON_1].");

  // The answer shows the real values again; the model itself only ever wrote placeholders.
  const answer = answers().last();
  await expect(answer).toContainText(`Last message as received: «Verse 1 200 € sur ${IBAN} pour Client A, merci à Jean Dupont.»`);
  await answer.getByRole("button", { name: "Voir la réponse telle que l'IA l'a écrite" }).click();
  await expect(answer).toContainText("«Verse 1 200 € sur [IBAN_1] pour [CLIENT_1], merci à [PERSON_1].»");
  await shot(page, "52-hide-sent");

  // Same value, same placeholder for the whole conversation, even written differently.
  await send("Rappelle-moi l'IBAN FR7630006000011234567890189 stp");
  await userMessages().last().getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(userMessages().last()).toContainText("Rappelle-moi l'IBAN [IBAN_1] stp");
  await page.reload();
  await expect(userMessages().first().locator(".line-through", { hasText: IBAN })).toBeVisible();
});

test("auto-protect off: everything arrives red, a click protects, and red items are confirmed before sending", async () => {
  await page.getByRole("switch", { name: "Masquage auto" }).click();
  await expect(page.getByRole("switch", { name: "Masquage auto" })).not.toBeChecked();
  await composer().fill("Appelle Nathalie au 06 12 34 56 78 demain");
  await expect(item("06 12 34 56 78")).toHaveAttribute("data-hide", "visible");
  await expect(item("Nathalie")).toHaveAttribute("data-hide", "visible");
  await expect(page.getByText("2 éléments sensibles repérés — cliquez dessus pour les protéger")).toBeVisible();
  await shot(page, "53-hide-manual");

  await clickItem("06 12 34 56 78");
  await expect(item("06 12 34 56 78")).toHaveAttribute("data-hide", "protected");
  // Any selected passage can be protected.
  await composer().press("End");
  for (let i = 0; i < 6; i++) await composer().press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Protéger « demain »" }).click();
  await expect(item("demain")).toHaveAttribute("data-hide", "protected");

  // Nathalie is still red: the app asks before sending.
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("1 élément sensible n’est pas protégé.")).toBeVisible();
  await shot(page, "54-hide-confirm");
  await page.getByRole("button", { name: "Protéger et envoyer" }).click();
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  const message = userMessages().last();
  await message.getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(message).toContainText(/Appelle \[PERSON_\d\] au \[PHONE_1\] \[REDACTED_1\]/);

  // "Envoyer tel quel" sends what is red as typed.
  const before = await answers().count();
  await composer().fill("Rappelle Sophie Martin");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await page.getByRole("button", { name: "Envoyer tel quel" }).click();
  await expect(answers()).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(answers().last()).toContainText("Last message as received: «Rappelle Sophie Martin»");
  await expect(userMessages().last()).not.toContainText("protégé");

  await page.getByRole("switch", { name: "Masquage auto" }).click();
  await expect(page.getByRole("switch", { name: "Masquage auto" })).toBeChecked();
});

test("files: the chip says what is protected; the preview works with the same click", async () => {
  await page.locator('input[type="file"]').setInputFiles({
    name: "rib-fournisseur.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Coordonnées bancaires : DE89 3704 0044 0532 0130 00\nContact : paul.martin@exemple.fr"),
  });
  await expect(page.getByRole("button", { name: /rib-fournisseur\.txt.*2 protégés/ })).toBeVisible();
  await page.getByRole("button", { name: /^rib-fournisseur\.txt/ }).click();
  const preview = page.getByRole("dialog", { name: "rib-fournisseur.txt" });
  await expect(preview.getByRole("button", { name: /Laisser visible : DE89/ })).toBeVisible();
  // Leave the email visible to the AI: it turns red, the chip asks to check it.
  await preview.getByRole("button", { name: "Laisser visible : paul.martin@exemple.fr" }).click();
  await expect(preview.getByRole("button", { name: "Protéger : paul.martin@exemple.fr" })).toBeVisible();
  await shot(page, "55-hide-file-preview");
  await preview.getByRole("button", { name: "Terminé" }).click();
  await expect(page.getByRole("button", { name: /rib-fournisseur\.txt.*1 à vérifier/ })).toBeVisible();

  await send("Résume ce fichier");
  const message = userMessages().last();
  await expect(message).toContainText("1 élément protégé");
  await expect(message).toContainText("dans les fichiers joints");
  const answer = answers().last();
  await answer.getByRole("button", { name: "Voir la réponse telle que l'IA l'a écrite" }).click();
  await expect(answer).toContainText("[IBAN_2]");
  // Left visible by choice: sent as typed.
  await expect(answer).toContainText("Contact : paul.martin@exemple.fr");
});

test("admin: auto-protect by default, categories and custom terms; the activity log has counts, never values", async () => {
  await page.goto("/admin/hide");
  await expect(page.getByRole("heading", { name: "Protection des données (Hide)" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Masquage automatique par défaut" })).toBeChecked();
  await page.getByRole("textbox", { name: "Terme sensible" }).fill("Projet Phoenix");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText("Terme ajouté.")).toBeVisible();
  await page.getByRole("switch", { name: "Montant" }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages de protection enregistrés.")).toBeVisible();
  await shot(page, "56-admin-hide");

  await page.goto("/chat");
  await send("Budget du projet phoenix : 12 k€");
  await userMessages().last().getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(userMessages().last()).toContainText("Budget du [PROJECT_1] : [AMOUNT_1]");

  await page.goto("/admin/activity");
  await expect(page.getByText("a envoyé un message à l'IA avec 3 éléments masqués (IBAN, Client, Nom de personne)")).toBeVisible();
  await expect(page.getByText("a ajouté un terme sensible (Projet)")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("FR76");
  await expect(page.getByRole("main")).not.toContainText("Phoenix");
});

test("the protection control fits on a phone", async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
  const p = await phone.newPage();
  await signIn(p, owner);
  await p.goto("/chat");
  await p.getByRole("textbox", { name: "Écrivez votre message…" }).fill(`Virement sur ${IBAN} pour Client A`);
  await expect(p.locator("[data-hide]").first()).toBeVisible();
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(p, "57-hide-mobile");
  await phone.close();
});
