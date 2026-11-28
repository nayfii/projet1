import { test, expect, devices } from "@playwright/test";
import { signIn, skipAvatarStep } from "./helpers";

/** Design captures on demand (DESIGN_SHOTS=<dir>): the chat in light and dark, computer and phone. */
test.skip(!process.env.DESIGN_SHOTS, "captures on demand");
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});
test("chat captures", async ({ browser }) => {
  test.setTimeout(120_000);
  const dir = process.env.DESIGN_SHOTS!;
  const label = process.env.DESIGN_LABEL ?? "shot";
  const run = Date.now().toString(36);
  const email = `design-${run}@demo.local`;
  const ctx = await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ["microphone"] });
  const page = await ctx.newPage();
  await signIn(page, email);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Atelier ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Passer" }).click();
  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Écrivez votre message…" }).fill("Peux-tu me résumer les points clés d'une bonne proposition commerciale ?");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole("textbox", { name: "Écrivez votre message…" }).fill("Et pour un client dans l'industrie ?");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.locator("article")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  const conversation = page.url();
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await ctx.addCookies([{ name: "theme", value: scheme, url: "http://localhost:3000" }]);
    await page.reload();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/${label}-desktop-${scheme}.png` });
  }
  const composerBox = async () => {
    const box = (await page.locator("main form, main .chat-composer, main [class*='rounded-[22px]']").last().boundingBox())!;
    return { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 24), width: box.width + 48, height: box.height + 64 };
  };
  await page.getByRole("button", { name: "Dicter" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/${label}-dictation-light.png`, clip: await composerBox() });
  await page.keyboard.press("Escape");
  const plus = page.getByRole("button", { name: "Ajouter des fichiers et plus" });
  if (await plus.count()) {
    await plus.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${label}-plus-menu-light.png` });
    await page.keyboard.press("Escape");
  }
  await page.goto("/chat");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${label}-new-chat-light.png` });
  await page.emulateMedia({ colorScheme: "dark" });
  await ctx.addCookies([{ name: "theme", value: "system", url: "http://localhost:3000" }]);
  await page.reload();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/${label}-new-chat-system-dark.png` });
  await page.emulateMedia({ colorScheme: "light" });
  for (const [name, path] of [["home", "/"], ["admin", "/admin"], ["profile", "/profile"], ["workflows", "/workflows"]] as const) {
    await page.goto(path);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${dir}/${label}-page-${name}-light.png` });
  }
  const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "fr-FR" });
  const mobile = await phone.newPage();
  await signIn(mobile, email);
  await phone.addCookies([{ name: "theme", value: "light", url: "http://localhost:3000" }]);
  await mobile.goto(conversation);
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: `${dir}/${label}-phone-light.png` });
  await phone.close();
  await ctx.close();
});
