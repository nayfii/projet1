import { test, expect, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signIn, skipAvatarStep } from "./helpers";
import { syntheticVoice } from "./voice";

/**
 * Dictation reliability in a real browser (CLAUDE.md §12, V1.1 phase 7): the bar at once, a refused or
 * missing microphone, the first words while talking, the text in the box at once and editable, the
 * polished version only if the text is untouched, a cut network (retry, message, then it works again),
 * stopping while parts are still being transcribed, dictating again after the text, and a phone.
 * Chromium's fake microphone plays a synthetic voice; the transcription model is simulated.
 */
const voice = syntheticVoice();
test.describe.configure({ mode: "serial" });
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${voice}`],
  },
});

/** The microphone as the page sees it: normal, slow to open, refused, or missing; open tracks counted. */
const MICROPHONE = () => {
  const w = window as unknown as { __mic: string; __streams: MediaStream[]; __liveTracks: () => number };
  const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  w.__mic = "normal";
  w.__streams = [];
  w.__liveTracks = () => w.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length;
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (w.__mic === "deny") throw new DOMException("Permission denied", "NotAllowedError");
    if (w.__mic === "missing") throw new DOMException("Requested device not found", "NotFoundError");
    if (w.__mic === "slow") await new Promise((resolve) => setTimeout(resolve, 1200));
    const stream = await open(constraints);
    w.__streams.push(stream);
    return stream;
  };
};

const run = Date.now().toString(36);
const email = `dict-rel-${run}@demo.local`;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR", permissions: ["microphone"], viewport: { width: 1280, height: 860 } });
  await context.addInitScript(MICROPHONE);
  page = await context.newPage();
});
test.afterAll(async () => context.close());

const composer = (p: Page = page) => p.getByRole("textbox", { name: "Écrivez votre message…" });
const bar = (p: Page = page) => p.getByTestId("dictation-bar");
const setMic = (mode: "normal" | "slow" | "deny" | "missing") => page.evaluate((m) => ((window as unknown as { __mic: string }).__mic = m), mode);
const liveTracks = () => page.evaluate(() => (window as unknown as { __liveTracks: () => number }).__liveTracks());

/** Records for about `ms`, then stops with "Terminer et transcrire". */
async function dictate(ms: number, p: Page = page) {
  await p.getByRole("button", { name: "Dicter" }).click();
  await expect(bar(p)).toHaveAttribute("aria-label", "Enregistrement en cours");
  await p.waitForTimeout(ms);
  await p.getByRole("button", { name: "Terminer et transcrire" }).click();
}

test("an owner with a fresh company opens the chat", async () => {
  await signIn(page, email);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Écho ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Passer" }).click();
  await page.goto("/chat");
  await expect(page.getByRole("button", { name: "Dicter" })).toBeEnabled();
});

test("the bar shows at once, while the microphone opens; cancelling then leaves nothing open", async () => {
  await setMic("slow");
  await page.getByRole("button", { name: "Dicter" }).click();
  await expect(bar()).toHaveAttribute("aria-label", "Ouverture du micro…");
  await page.getByRole("button", { name: "Annuler l'enregistrement" }).click();
  await expect(bar()).toBeHidden();
  // The microphone opens after the cancel: it is closed at once, nothing records.
  await page.waitForTimeout(1600);
  await expect(bar()).toBeHidden();
  expect(await liveTracks()).toBe(0);
  await expect(composer()).toHaveValue("");
  // Slow but not cancelled: it listens once the microphone is open.
  await page.getByRole("button", { name: "Dicter" }).click();
  await expect(bar()).toHaveAttribute("aria-label", "Ouverture du micro…");
  await expect(bar()).toHaveAttribute("aria-label", "Enregistrement en cours", { timeout: 5_000 });
  await page.getByRole("button", { name: "Annuler l'enregistrement" }).click();
  await expect(bar()).toBeHidden();
  expect(await liveTracks()).toBe(0);
  await setMic("normal");
});

test("a refused microphone says how to allow it; a missing one says so; the button still works", async () => {
  await setMic("deny");
  await page.getByRole("button", { name: "Dicter" }).click();
  await expect(page.getByText("Le micro n'est pas autorisé. Autorisez-le dans les réglages du navigateur.")).toBeVisible();
  await expect(bar()).toBeHidden();
  await setMic("missing");
  await page.getByRole("button", { name: "Dicter" }).click();
  await expect(page.getByText("Aucun micro n'a été trouvé. Branchez-en un, puis réessayez.")).toBeVisible();
  await expect(bar()).toBeHidden();
  await setMic("normal");
  await expect(page.getByRole("button", { name: "Dicter" })).toBeEnabled();
});

test("the first words show while talking; stopping puts the text in the box at once, to edit", async () => {
  await page.getByRole("button", { name: "Dicter" }).click();
  await expect(bar()).toHaveAttribute("aria-label", "Enregistrement en cours");
  await expect(page.getByTestId("dictation-live")).toContainText("ceci est une dictée", { timeout: 8_000 });
  await expect(bar()).toBeVisible();
  await page.getByRole("button", { name: "Terminer et transcrire" }).click();
  await expect(composer()).toHaveValue(/^Ceci est une dictée de démonstration \(mode test\)\./, { timeout: 10_000 });
  await expect(page.getByTestId("dictation-live")).toBeHidden();
  expect(await liveTracks()).toBe(0);
  await composer().press("End");
  await composer().pressSequentially(" Merci.");
  await expect(composer()).toHaveValue(/\(mode test\)\. Merci\.$/);
});

test("dictating again adds the new text after what is already there", async () => {
  await composer().fill("Bonjour.");
  await dictate(2_000);
  await expect(composer()).toHaveValue(/^Bonjour\. Ceci est une dictée de démonstration \(mode test\)\./, { timeout: 10_000 });
  await composer().fill("");
});

test("the polished version takes the text's place only if the person has not changed it", async () => {
  await page.route("**/api/dictation/clean", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({ json: { ok: true, text: "Texte mis au propre par le modèle.", polished: true } });
  });
  await dictate(2_000);
  // Our own rules first (at once), then the polished version.
  await expect(composer()).toHaveValue(/^Ceci est une dictée de démonstration/, { timeout: 10_000 });
  await expect(composer()).toHaveValue("Texte mis au propre par le modèle.", { timeout: 5_000 });
  await page.getByRole("button", { name: "Voir l'original" }).click();
  await expect(composer()).toHaveValue(/^Euh, ceci est une dictée de démonstration/);
  await composer().fill("");

  await page.unroute("**/api/dictation/clean");
  await page.route("**/api/dictation/clean", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.fulfill({ json: { ok: true, text: "Texte mis au propre par le modèle.", polished: true } });
  });
  await dictate(2_000);
  await expect(composer()).toHaveValue(/^Ceci est une dictée de démonstration/, { timeout: 10_000 });
  await composer().press("End");
  await composer().pressSequentially(" Et ceci.");
  await page.waitForTimeout(2_500);
  await expect(composer()).toHaveValue(/\(mode test\)\. Et ceci\.$/);
  await page.unroute("**/api/dictation/clean");
  await composer().fill("");
});

test("a cut network: the part is tried again, then the person is told; the next dictation works", async () => {
  let calls = 0;
  await page.route("**/api/dictation", (route) => {
    calls++;
    return route.abort("internetdisconnected");
  });
  await dictate(2_000);
  await expect(page.getByText("La transcription a échoué. Réessayez.")).toBeVisible({ timeout: 10_000 });
  // Each part is tried twice (the voice may have been cut in more than one part).
  expect(calls).toBeGreaterThanOrEqual(2);
  expect(calls % 2).toBe(0);
  await expect(composer()).toHaveValue("");
  await expect(page.getByRole("button", { name: "Dicter" })).toBeEnabled();
  await page.unroute("**/api/dictation");
  await dictate(2_000);
  await expect(composer()).toHaveValue(/^Ceci est une dictée de démonstration/, { timeout: 10_000 });
  await composer().fill("");
});

test("stopping while parts are still being transcribed waits for them: nothing is lost, in order", async () => {
  let parts = 0;
  await page.route("**/api/dictation", async (route) => {
    parts++;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await dictate(6_500);
  await expect(page.getByRole("button", { name: "Transcription…" })).toBeVisible();
  await expect(composer()).toHaveValue(/démonstration \(mode test\)\.$/, { timeout: 15_000 });
  const sentences = ((await composer().inputValue()).match(/Ceci est une dictée/g) ?? []).length;
  expect(parts).toBeGreaterThanOrEqual(2);
  expect(sentences).toBe(parts);
  await page.unroute("**/api/dictation");
  await composer().fill("");
});

test("on a phone, the bar fits the screen and the text lands in the box", async ({ browser }) => {
  const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "fr-FR", permissions: ["microphone"] });
  await phone.addInitScript(MICROPHONE);
  const mobile = await phone.newPage();
  await signIn(mobile, email);
  await mobile.goto("/chat");
  await mobile.getByRole("button", { name: "Dicter" }).tap();
  await expect(bar(mobile)).toHaveAttribute("aria-label", "Enregistrement en cours");
  const box = await bar(mobile).boundingBox();
  const width = mobile.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mobile.waitForTimeout(2_000);
  await mobile.getByRole("button", { name: "Terminer et transcrire" }).tap();
  await expect(composer(mobile)).toHaveValue(/^Ceci est une dictée de démonstration/, { timeout: 10_000 });
  await phone.close();
});
