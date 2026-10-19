import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { shot, signIn } from "./helpers";

/**
 * Step 4 (Hide), in a real browser. The server must run with AI_FAKE_PROVIDER=true: the simulated
 * model repeats the last message exactly as it received it, which shows what was masked.
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

async function send(text: string) {
  const before = await answers().count();
  await composer().fill(text);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(answers()).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

test("Automatic: the AI receives placeholders, the person sees the real values", async () => {
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
  // Company defaults: Automatic and Documents on, Manual off.
  await expect(page.getByRole("button", { name: "Automatique" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Documents" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Manuel" })).toHaveAttribute("aria-pressed", "false");

  await composer().fill(`Verse 1 200 € sur ${IBAN} pour Client A, merci à Jean Dupont.`);
  // Detected on our server while typing: IBAN, client, person (amounts are off by default).
  await expect(page.getByText("3 éléments seront masqués")).toBeVisible();
  await shot(page, "50-hide-bar");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(answers()).toHaveCount(1);

  // The person's own message keeps the real values; the AI received placeholders.
  const message = userMessages().last();
  await expect(message).toContainText(IBAN);
  await expect(message).toContainText("3 éléments masqués");
  await message.getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(message).toContainText("Verse 1 200 € sur [IBAN_1] pour [CLIENT_1], merci à [PERSON_1].");

  // The simulated model repeats what it received: the real values are put back for the person…
  const answer = answers().last();
  await expect(answer).toContainText(`Last message as received: «Verse 1 200 € sur ${IBAN} pour Client A, merci à Jean Dupont.»`);
  // …while the model itself only ever wrote placeholders.
  await answer.getByRole("button", { name: "Voir la réponse telle que l'IA l'a écrite" }).click();
  await expect(answer).toContainText("«Verse 1 200 € sur [IBAN_1] pour [CLIENT_1], merci à [PERSON_1].»");
  await shot(page, "51-hide-received");

  // Same value, same placeholder for the whole conversation, even written differently.
  await send("Rappelle-moi l'IBAN FR7630006000011234567890189 stp");
  await userMessages().last().getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(userMessages().last()).toContainText("Rappelle-moi l'IBAN [IBAN_1] stp");

  // Saved: still there after a reload.
  await page.reload();
  await expect(userMessages().first()).toContainText("3 éléments masqués");
});

test("Manual: red highlights, click to show or blur, blur any selection", async () => {
  await page.getByRole("button", { name: "Manuel" }).click();
  await expect(page.getByRole("button", { name: "Manuel" })).toHaveAttribute("aria-pressed", "true");
  await composer().fill("Appelle Nathalie au 06 12 34 56 78 demain");
  const phone = page.locator("[data-hide]", { hasText: "06 12 34 56 78" });
  // Automatic is on too: detected items start blurred.
  await expect(phone).toHaveAttribute("data-hide", "masked");
  await expect(page.locator("[data-hide]", { hasText: "Nathalie" })).toHaveAttribute("data-hide", "masked");
  await shot(page, "52-hide-manual");

  // A click on an item leaves it visible (red, not masked)…
  const box = (await phone.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(phone).toHaveAttribute("data-hide", "detected");
  // …and any selected passage can be blurred.
  await composer().press("End");
  for (let i = 0; i < 6; i++) await composer().press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Masquer la sélection" }).click();
  await expect(page.locator("[data-hide]", { hasText: "demain" })).toHaveAttribute("data-hide", "masked");
  await shot(page, "53-hide-manual-choices");

  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  const message = userMessages().last();
  await message.getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(message).toContainText(/Appelle \[PERSON_\d\] au 06 12 34 56 78 \[REDACTED_1\]/);
  await page.getByRole("button", { name: "Manuel" }).click();
});

test("Documents: sensitive data in an attached file is masked too", async () => {
  await page.locator('input[type="file"]').setInputFiles({
    name: "rib-fournisseur.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Coordonnées bancaires : DE89 3704 0044 0532 0130 00. Contact : paul.martin@exemple.fr"),
  });
  await expect(page.getByText("rib-fournisseur.txt")).toBeVisible();
  await send("Résume ce fichier");
  const message = userMessages().last();
  await expect(message).toContainText("2 éléments masqués");
  await expect(message).toContainText("dans les fichiers joints");
  const answer = answers().last();
  await answer.getByRole("button", { name: "Voir la réponse telle que l'IA l'a écrite" }).click();
  await expect(answer).toContainText("[IBAN_2]");
  await expect(answer).toContainText("[EMAIL_1]");
  await shot(page, "54-hide-documents");
});

test("Admin: custom sensitive terms and categories; the activity log has counts, never values", async () => {
  await page.goto("/admin/hide");
  await expect(page.getByRole("heading", { name: "Protection des données (Hide)" })).toBeVisible();
  await page.getByRole("textbox", { name: "Terme sensible" }).fill("Projet Phoenix");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText("Terme ajouté.")).toBeVisible();
  await expect(page.getByText("Projet Phoenix", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Montant" }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages de protection enregistrés.")).toBeVisible();
  await shot(page, "55-admin-hide");

  await page.goto("/chat");
  await send("Budget du projet phoenix : 12 k€");
  await userMessages().last().getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(userMessages().last()).toContainText("Budget du [PROJECT_1] : [AMOUNT_1]");

  await page.goto("/admin/activity");
  await expect(page.getByText("a envoyé un message à l'IA avec 3 éléments masqués (IBAN, Client, Nom de personne)")).toBeVisible();
  await expect(page.getByText("a ajouté un terme sensible (Projet)")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("FR76");
  await expect(page.getByRole("main")).not.toContainText("Phoenix");
  await shot(page, "56-activity-hide");
});
