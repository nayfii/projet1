import * as fs from "node:fs";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signIn, skipAvatarStep } from "./helpers";
import { syntheticVoice } from "./voice";

/**
 * Dictation speed, measured in a real browser (run on demand: DICTATION_BENCH=1).
 * Chromium's fake microphone plays a synthetic "voice" (syllable-like bursts with pauses between
 * phrases), the app runs with the simulated provider; the server can make the simulated model wait
 * (DICTATION_FAKE_LATENCY_MS) like a real one would. What is measured comes from the app's own timing
 * marks (src/modules/dictation/timing.ts) and the server's Server-Timing header — never any content.
 * The results go to node_modules/.cache/cendr-e2e/dictation-speed-<label>.json (kept between runs).
 */
const RUNS = Number(process.env.DICTATION_BENCH_RUNS ?? 8);
const LABEL = process.env.DICTATION_BENCH_LABEL ?? "run";
/** When the person stops, counted from their click (mid-phrase, like a real stop). */
const STOP_AT_MS = 8_000;

const VOICE = process.env.DICTATION_BENCH_VOICE === "early-pause" ? "early-pause" : "long-phrases";
const voice = syntheticVoice(VOICE);

test.skip(!process.env.DICTATION_BENCH, "speed measurement, run on demand (DICTATION_BENCH=1)");
test.describe.configure({ mode: "serial" });
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${voice}`],
  },
});

let context: BrowserContext;
let page: Page;
const run = Date.now().toString(36);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR", permissions: ["microphone"], viewport: { width: 1280, height: 860 } });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

test("an owner with a fresh company opens the chat", async () => {
  await signIn(page, `dict-speed-${run}@demo.local`);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Voix ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Passer" }).click();
  await page.goto("/chat");
  await expect(page.getByRole("button", { name: "Dicter" })).toBeEnabled();
});

type Sample = { listening: number | null; firstText: number | null; final: number | null; polished: number | null; serverChecks: number[]; serverModel: number[]; parts: number; failed: boolean };

test(`dictation timings over ${RUNS} recordings`, async () => {
  test.setTimeout(RUNS * 45_000 + 30_000);
  const composer = page.getByRole("textbox", { name: "Écrivez votre message…" });
  const samples: Sample[] = [];
  for (let i = 0; i < RUNS; i++) {
    await composer.fill("");
    await page.evaluate(() => {
      performance.clearMarks();
      performance.clearResourceTimings();
    });
    const started = Date.now();
    await page.getByRole("button", { name: "Dicter" }).click();
    await expect(page.getByTestId("dictation-bar")).toBeVisible();
    await page.waitForTimeout(Math.max(0, STOP_AT_MS - (Date.now() - started)));
    await page.getByRole("button", { name: "Terminer et transcrire" }).click();
    let failed = false;
    try {
      await page.waitForFunction(() => performance.getEntriesByName("cendr:dictation:text").length > 0, null, { timeout: 30_000 });
      // The polished version, when the pipeline delivers one after the text (it may not).
      await page.waitForFunction(() => performance.getEntriesByName("cendr:dictation:polished").length > 0, null, { timeout: 6_000 }).catch(() => null);
      await expect(composer).not.toHaveValue("");
    } catch {
      failed = true;
    }
    const sample = await page.evaluate(() => {
      const at = (name: string) => performance.getEntriesByName(`cendr:dictation:${name}`)[0]?.startTime ?? null;
      const since = (from: string, to: string) => {
        const a = at(from);
        const b = at(to);
        return a === null || b === null ? null : Math.round(b - a);
      };
      const parts = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((e) => new URL(e.name).pathname === "/api/dictation");
      const timing = (name: string) => parts.map((p) => p.serverTiming?.find((t) => t.name === name)?.duration).filter((v): v is number => typeof v === "number");
      return {
        listening: since("click", "listening"),
        firstText: since("click", "first-text"),
        final: since("stop", "text"),
        polished: since("stop", "polished"),
        serverChecks: timing("checks"),
        serverModel: timing("model"),
        parts: parts.length,
      };
    });
    samples.push({ ...sample, failed: failed || sample.final === null });
    // Let the toast and any late work settle between recordings.
    await page.waitForTimeout(800);
  }

  const values = (pick: (s: Sample) => number | null | number[]) =>
    samples
      .filter((s) => !s.failed)
      .flatMap((s) => pick(s) ?? [])
      .filter((v): v is number => typeof v === "number");
  const stats = (list: number[]) => {
    const sorted = [...list].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
    return { n: sorted.length, median: q(0.5), p90: q(0.9), min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
  };
  const report = {
    label: LABEL,
    voice: VOICE,
    runs: RUNS,
    stopAtMs: STOP_AT_MS,
    simulatedModelLatencyMs: Number(process.env.DICTATION_FAKE_LATENCY_MS ?? 0),
    failures: samples.filter((s) => s.failed).length,
    clickToListening: stats(values((s) => s.listening)),
    clickToFirstText: stats(values((s) => s.firstText)),
    stopToText: stats(values((s) => s.final)),
    stopToPolished: stats(values((s) => s.polished)),
    serverChecksPerPart: stats(values((s) => s.serverChecks)),
    serverModelPerPart: stats(values((s) => s.serverModel)),
    partsPerRecording: stats(values((s) => s.parts)),
    samples,
  };
  fs.mkdirSync("node_modules/.cache/cendr-e2e", { recursive: true });
  fs.writeFileSync(`node_modules/.cache/cendr-e2e/dictation-speed-${LABEL}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, samples: undefined }, null, 2));
  expect(report.failures).toBe(0);
});
