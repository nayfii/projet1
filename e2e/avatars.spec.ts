import { test, expect, type Page } from "@playwright/test";
import { shot, signIn, skipAvatarStep } from "./helpers";

/**
 * Step 11: the avatar moment in onboarding (test mode: a demo avatar, no AI called), the avatar in
 * the app, privacy between companies, and the assistants' characters in the chat.
 */
const run = Date.now().toString(36);
const owner = `avatar-owner-${run}@demo.local`;
const outsider = `avatar-outsider-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

/** A real JPEG photo, drawn in the browser. */
async function photo(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#c98f6b";
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = "#3b2a22";
    ctx.beginPath();
    ctx.arc(320, 200, 120, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL("image/jpeg", 0.9);
  });
  return { name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
}

let avatarUrl = "";

test("the owner creates an avatar during onboarding", async ({ page }) => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Inès Morel");
  await page.getByLabel("Nom de l'entreprise").fill(`Studio Avatar ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page.getByRole("heading", { name: "Créez votre avatar" })).toBeVisible();
  await expect(page.getByText(/envoyée au modèle d'images d'OpenAI/)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(await photo(page));
  await expect(page.getByRole("button", { name: "C'est moi !" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Avatar de démonstration (mode test).")).toBeVisible();
  await shot(page, "av01-onboarding-avatar");
  await page.getByRole("button", { name: "C'est moi !" }).click();
  // Kept, then on to the next step on its own.
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();

  await page.goto("/profile");
  const img = page.getByRole("img", { name: "Avatar de Inès Morel" });
  await expect(img).toBeVisible();
  avatarUrl = (await img.getAttribute("src"))!;
  expect(avatarUrl).toMatch(/^\/api\/avatars\/[0-9a-f-]{36}\?v=[0-9a-f-]{36}$/);
  const res = await page.request.get(avatarUrl);
  expect(res.status()).toBe(200);
  // A transparent PNG, set on glass by the app.
  expect(res.headers()["content-type"]).toBe("image/png");
});

test("someone from another company cannot load that avatar", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(page, outsider);
  await page.getByLabel("Votre nom").fill("Hugo Vidal");
  await page.getByLabel("Nom de l'entreprise").fill(`Autre ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  expect((await page.request.get(avatarUrl)).status()).toBe(404);
  expect((await page.request.get(avatarUrl.replace(/\?.*$/, "?pending=x"))).status()).toBe(404);
});

test("the assistants appear as characters in the chat", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/chat");
  const picker = page.getByRole("radiogroup", { name: "Choisir l'assistant" });
  await expect(picker).toBeVisible();
  await picker.getByRole("radio", { name: "Claude" }).click();
  await expect(picker.getByRole("radio", { name: "Claude" })).toHaveAttribute("aria-checked", "true");
  await shot(page, "av02-chat-empty");
  await page.getByRole("textbox", { name: "Écrivez votre message…" }).fill("Bonjour, présente-toi en une phrase.");
  await page.keyboard.press("Enter");
  await expect(page.locator('article [data-assistant="anthropic"]')).toBeVisible();
  await expect(page.getByText("[TEST]")).toBeVisible();
  await shot(page, "av03-chat-answer");
});

test("the owner can go back to initials", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Utiliser mes initiales" }).click();
  await expect(page.getByRole("button", { name: "Importer une photo" })).toBeVisible();
  expect((await page.request.get(avatarUrl)).status()).toBe(404);
});
