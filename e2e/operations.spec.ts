import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Operations through the real site (V1.1 phase 10): the endpoints called without a session (the health
 * check, our clock, outside webhooks) reach their own checks instead of being sent to sign in; every
 * other API still asks to sign in; our team sees the operations panel in our console.
 */
test("the health check, the clock and webhooks reach their own checks; other APIs still need a session", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok", checks: { database: { ok: true } } });

  const clock = await request.get("/api/cron/workflows");
  expect(clock.status()).toBe(403);
  expect(await clock.json()).toEqual({ error: "forbidden" });

  const hook = await request.post("/api/workflows/hooks/00000000-0000-0000-0000-000000000000", { data: { hello: "world" } });
  expect(hook.status()).toBe(403);
  expect(await hook.json()).toEqual({ error: "forbidden" });

  const dictation = await request.post("/api/dictation");
  expect(dictation.status()).toBe(401);
  expect(await dictation.json()).toEqual({ error: "not_authenticated" });
});

test("our team sees the clock, the workflow queue and response times in the health page", async ({ page, request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const tick = await request.get("/api/cron/workflows", { headers: { authorization: `Bearer ${secret}` } });
    expect(tick.status()).toBe(200);
  }
  await signIn(page, "platform@demo.local");
  await page.goto("/platform/health");
  const ops = page.getByTestId("operations");
  await expect(ops).toContainText("Opérations (24 dernières heures)");
  await expect(page.getByTestId("ops-clock")).toContainText("Horloge des workflows");
  if (secret) await expect(page.getByTestId("ops-clock")).toContainText("À l'heure");
  await expect(page.getByTestId("ops-workflows")).toContainText("Exécutions de workflows");
  await expect(page.getByTestId("ops-latency")).toContainText("Temps de réponse par fonction");
});
