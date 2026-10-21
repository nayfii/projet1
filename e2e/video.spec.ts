import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { shot, signIn } from "./helpers";

/**
 * Step 8, the video agents (CLAUDE.md §4.7): Motion Design (composition → preview → MP4) and the Video
 * Editor (clips → edit plan → MP4 in several formats), made by the render worker, which must be running
 * (`node worker/dist/index.js`). AI_FAKE_PROVIDER=true: the composition and the plan are simulated
 * ("[TEST]"); the videos are really rendered.
 */
const run = Date.now().toString(36);
const owner = `video-owner-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await (await browser.newContext({ locale: "fr-FR", acceptDownloads: true })).newPage();
});

/** A small real video made with FFmpeg (test pattern, with or without sound). */
function clip(path: string, seconds: number, sound: boolean) {
  const args = ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=25:duration=${seconds}`];
  if (sound) args.push("-f", "lavfi", "-i", `sine=frequency=330:sample_rate=48000:duration=${seconds}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(sound ? ["-c:a", "aac"] : []), path);
  execFileSync("ffmpeg", args);
  return path;
}

function probe(path: string) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", path]).toString();
  const info = JSON.parse(out) as { streams: { width?: number; height?: number }[]; format: { duration: string } };
  const video = info.streams.find((s) => s.width);
  return { width: video?.width, height: video?.height, duration: Number(info.format.duration) };
}

async function waitForAnswer() {
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.locator("article")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
  return page.locator("article").last();
}

async function downloadVideo(answer: ReturnType<Page["locator"]>, format: string) {
  const [file] = await Promise.all([page.waitForEvent("download"), answer.getByRole("link", { name: `Télécharger le ${format}` }).click()]);
  return { name: file.suggestedFilename(), path: (await file.path())! };
}

test("setup: a company", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Studio Vidéo ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByLabel("Nom du client").fill("Client A");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByRole("heading", { name: "Votre premier document" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();
  await page.goto("/library");
});

test("the Marketing department offers both video agents", async () => {
  const marketing = page.getByRole("region", { name: "Marketing" });
  await expect(marketing.getByRole("link", { name: /Motion design/ })).toBeVisible();
  await expect(marketing.getByRole("link", { name: /Montage vidéo/ })).toBeVisible();
  await expect(marketing).not.toContainText("Bientôt");
});

test("Motion Design: a brief and a logo, a preview, then a real MP4", async () => {
  test.setTimeout(240_000);
  await page.goto("/library");
  await page.getByRole("link", { name: /Motion design/ }).click();
  await expect(page.getByText("La vidéo est fabriquée sur nos serveurs")).toBeVisible();
  await page.getByLabel("Brief (message, textes, public) *").fill("Annonce du nouvel atelier de Lyon, ouverture le 3 novembre, pour nos clients.");
  const logo = test.info().outputPath("logo.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x2a78d6:size=256x256", "-frames:v", "1", logo]);
  await page.getByLabel("Logo et images (PNG, JPG)").setInputFiles(logo);
  await page.getByRole("combobox", { name: "Format" }).click();
  await page.getByRole("option", { name: "9:16 · vertical" }).click();
  await page.getByRole("combobox", { name: "Durée" }).click();
  await page.getByRole("option", { name: "6 secondes" }).click();
  await shot(page, "90-motion-form");
  await page.getByRole("button", { name: "Lancer" }).click();

  const answer = await waitForAnswer();
  // The code is folded away; the preview plays it, isolated from the page.
  await expect(answer.getByText("Voir le code de l'animation")).toBeVisible();
  const player = answer.locator("[data-testid=motion-preview] hyperframes-player");
  await expect(player).toHaveCount(1);
  await expect(answer.getByText("Préparation de l'aperçu…")).toHaveCount(0, { timeout: 30_000 });
  expect(await player.evaluate((el) => el.shadowRoot?.querySelector("iframe")?.getAttribute("sandbox"))).toBe("allow-scripts");
  await expect(answer.getByText(/\d+ crédits vidéo · \d+ restants ce mois-ci/)).toBeVisible();
  await shot(page, "91-motion-preview");

  await answer.getByRole("button", { name: "Fabriquer la vidéo" }).click();
  await expect(page.getByText("C'est parti.")).toBeVisible();
  const job = answer.getByTestId("render-job").first();
  await expect(job).toHaveAttribute("data-status", /queued|running/);
  await shot(page, "92-motion-rendering");
  await expect(job).toHaveAttribute("data-status", "succeeded", { timeout: 180_000 });
  await expect(job.locator("video")).toHaveCount(1);
  await expect(job).toContainText("crédits vidéo utilisés");
  await shot(page, "93-motion-ready");

  const video = await downloadVideo(answer, "9:16 · vertical");
  expect(video.name).toBe("motion-9x16.mp4");
  expect(readFileSync(video.path).subarray(4, 8).toString()).toBe("ftyp");
  const info = probe(video.path);
  expect(info).toMatchObject({ width: 1080, height: 1920 });
  expect(info.duration).toBeCloseTo(6, 0);
});

test("Video Editor: two clips, an edit plan, then MP4s in the chosen formats", async () => {
  test.setTimeout(240_000);
  await page.goto("/library");
  await page.getByRole("link", { name: /Montage vidéo/ }).click();
  const a = clip(test.info().outputPath("plage.mp4"), 4, true);
  const b = clip(test.info().outputPath("atelier.mp4"), 3, false);
  await page.getByLabel("Clips vidéo (MP4, MOV, WebM) *").setInputFiles([a, b]);
  await expect(page.getByText("atelier.mp4")).toBeVisible();
  await page.getByLabel("Brief (ce que la vidéo doit montrer, durée, ton) *").fill("Un teaser de 6 secondes pour les réseaux sociaux : la plage puis l'atelier.");
  await page.getByRole("combobox", { name: "Formats" }).click();
  await page.getByRole("option", { name: "Les trois (16:9, 9:16 et 1:1)" }).click();
  await shot(page, "94-editor-form");
  await page.getByRole("button", { name: "Lancer" }).click();

  const answer = await waitForAnswer();
  // The clips went with the first message; the AI only received their names and lengths.
  await expect(page.getByRole("link", { name: "plage.mp4" })).toBeVisible();
  const plan = answer.getByRole("region", { name: "Plan de montage" });
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("[TEST] Montage");
  await expect(plan).toContainText("plage.mp4");
  await expect(plan).toContainText("[TEST] Sous-titre");
  // All three formats are ticked; keep two.
  await answer.getByRole("checkbox", { name: "1:1 · carré" }).click();
  await expect(answer.getByRole("button", { name: "Fabriquer les vidéos" })).toBeEnabled();
  await shot(page, "95-editor-plan");
  await answer.getByRole("button", { name: "Fabriquer les vidéos" }).click();
  const job = answer.getByTestId("render-job").first();
  await expect(job).toHaveAttribute("data-status", "succeeded", { timeout: 180_000 });
  await expect(job.locator("video")).toHaveCount(2);
  await shot(page, "96-editor-ready");

  const vertical = probe((await downloadVideo(answer, "9:16 · vertical")).path);
  expect(vertical).toMatchObject({ width: 1080, height: 1920 });
  expect(vertical.duration).toBeCloseTo(6, 0);
  const landscape = probe((await downloadVideo(answer, "16:9 · paysage")).path);
  expect(landscape).toMatchObject({ width: 1920, height: 1080 });
});

test("the company sees its video credits apart from its AI credits", async () => {
  await page.goto("/admin/quotas");
  const card = page.getByRole("region", { name: "Crédits vidéo" });
  await expect(card).toContainText(/\d+ sur \d+ crédits vidéo utilisés ce mois-ci/);
  await shot(page, "97-video-credits");
});
