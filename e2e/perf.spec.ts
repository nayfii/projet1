import * as fs from "node:fs";
import { execSync } from "node:child_process";
import pg from "pg";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signIn, skipAvatarStep } from "./helpers";

/**
 * Page speed on heavy cases, measured in a real browser (run on demand: PERF_BENCH=1). Our console's
 * companies list with every local test company, a conversation of 600 messages, a workflow of 50 steps (the limit),
 * the chat's home. For each: the server's answer, when the page is usable (a page-specific element),
 * the main thread blocked by long tasks, the page's size (DOM nodes, JavaScript). Medians of 3 loads.
 * The results go to node_modules/.cache/cendr-e2e/perf-<label>.json.
 */
const LABEL = process.env.PERF_BENCH_LABEL ?? "run";
const LOADS = 3;
test.skip(!process.env.PERF_BENCH, "speed measurement, run on demand (PERF_BENCH=1)");
test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let conversationId = "";
let workflowId = "";
const run = Date.now().toString(36);
const results: Record<string, unknown> = {};

const db = async <T,>(sql: string, params: unknown[] = []) => {
  const status = JSON.parse(execSync("supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString()) as { DB_URL: string };
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
};

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    const w = window as unknown as { __longTasks: number };
    w.__longTasks = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__longTasks += e.duration;
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // No long-task timing in this browser.
    }
  });
  page = await context.newPage();
});
test.afterAll(async () => {
  fs.mkdirSync("node_modules/.cache/cendr-e2e", { recursive: true });
  fs.writeFileSync(`node_modules/.cache/cendr-e2e/perf-${LABEL}.json`, JSON.stringify({ label: LABEL, ...results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await context.close();
});

/** Loads `path` LOADS times; medians of what the browser measured. */
async function measure(name: string, path: string, ready: (p: Page) => Promise<void>) {
  const samples: Record<string, number>[] = [];
  for (let i = 0; i < LOADS; i++) {
    const started = Date.now();
    await page.goto(path);
    await ready(page);
    const usable = Date.now() - started;
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const scripts = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((r) => r.initiatorType === "script");
      return {
        serverMs: Math.round(nav.responseStart - nav.requestStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        longTasksMs: Math.round((window as unknown as { __longTasks: number }).__longTasks),
        domNodes: document.getElementsByTagName("*").length,
        scriptKb: Math.round(scripts.reduce((sum, r) => sum + (r.decodedBodySize || 0), 0) / 1024),
      };
    });
    samples.push({ ...m, usableMs: usable });
  }
  const median = (key: string) => samples.map((s) => s[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  results[name] = Object.fromEntries(Object.keys(samples[0]).map((k) => [k, median(k)]));
}

test("data: an owner, a long conversation, a large workflow", async () => {
  test.setTimeout(120_000);
  await signIn(page, `perf-${run}@demo.local`);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Perf ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Passer" }).click();
  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Écrivez votre message…" }).fill("Bonjour");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  conversationId = page.url().split("/chat/")[1].split(/[?#]/)[0];
  const [conv] = await db<{ company_id: string; owner_id: string }>("select company_id, owner_id from public.conversations where id = $1", [conversationId]);
  // 600 more messages: questions and longer answers with lists, a table and code, like real work.
  const answer = (i: number) =>
    `## Point ${i}\n\nVoici une synthèse du sujet **${i}** avec les éléments utiles :\n\n- premier élément à retenir pour le dossier ${i}\n- deuxième élément, avec un [lien](https://example.com/${i})\n- troisième élément\n\n| Poste | Montant |\n|---|---|\n| Licence | ${i * 10} € |\n| Support | ${i * 3} € |\n\n\`\`\`ts\nconst total = ${i * 13};\n\`\`\`\n\nEn résumé, la proposition ${i} reste cohérente avec le budget.`;
  await db(
    `insert into public.messages (conversation_id, company_id, seq, author_type, author_id, content, status, provider, model_id, model_label, created_at)
     select $1, $2, 10 + g, case when g % 2 = 0 then 'user' else 'assistant' end, case when g % 2 = 0 then $3::uuid else null end,
       case when g % 2 = 0 then 'Peux-tu détailler le point ' || g || ' ?' else $4 end, 'complete',
       case when g % 2 = 0 then null else 'openai'::public.ai_provider end, case when g % 2 = 0 then null else 'gpt-test' end, case when g % 2 = 0 then null else 'ChatGPT' end,
       now() - interval '1 day' + g * interval '1 minute'
     from generate_series(1, 600) g`,
    [conversationId, conv.company_id, conv.owner_id, answer(7)],
  );
  // A workflow at the limit: 50 steps in a chain.
  const nodes = [{ id: "n0", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} }];
  const edges: { id: string; source: string; target: string; handle: string }[] = [];
  for (let i = 1; i < 50; i++) {
    nodes.push({ id: `n${i}`, type: i % 3 === 0 ? "ai.summarize" : "logic.set", position: { x: (i % 6) * 260, y: Math.floor(i / 6) * 140 }, config: i % 3 === 0 ? { input: "{{trigger.text}}" } : { name: `v${i}`, value: "x" } });
    edges.push({ id: `e${i}`, source: `n${i - 1}`, target: `n${i}`, handle: "out" });
  }
  const [wf] = await db<{ id: string }>(
    "insert into public.workflows (company_id, owner_id, name, draft) values ($1, $2, 'Grand workflow', $3) returning id",
    [conv.company_id, conv.owner_id, JSON.stringify({ nodes, edges })],
  );
  workflowId = wf.id;
});

test("measure the member pages", async () => {
  test.setTimeout(180_000);
  await measure("chatHome", "/chat", async (p) => {
    await expect(p.getByRole("textbox", { name: "Écrivez votre message…" })).toBeEditable();
  });
  await measure("longConversation600", `/chat/${conversationId}`, async (p) => {
    await expect(p.getByRole("textbox", { name: "Écrivez votre message…" })).toBeEditable();
    await expect(p.locator("article").last()).toBeVisible();
  });
  await measure("workflow50", `/workflows/${workflowId}`, async (p) => {
    await expect(p.getByRole("main").getByTestId("workflow-editor")).toBeVisible();
    await expect(p.getByRole("main").getByTestId("node-trigger.manual")).toBeVisible();
  });
  await measure("memory", "/memory", async (p) => {
    await expect(p.getByRole("main")).toBeVisible();
  });
});

test("measure our console's companies list", async () => {
  test.setTimeout(180_000);
  await context.clearCookies();
  await signIn(page, "platform@demo.local");
  const [{ n }] = await db<{ n: string }>("select count(*)::text as n from public.companies");
  results.companies = Number(n);
  await measure("platformCompanies", "/platform/companies", async (p) => {
    await expect(p.getByRole("textbox", { name: /Rechercher/ })).toBeVisible();
    await expect(p.getByRole("row").nth(1)).toBeVisible();
  });
  // The "Inscription libre" switch: the time until it answers.
  const toggle = page.getByRole("switch").last();
  const before = await toggle.getAttribute("aria-checked");
  const started = Date.now();
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-checked", before ?? "", { timeout: 30_000 });
  await expect(toggle).toBeEnabled({ timeout: 30_000 });
  results.signupSwitchMs = Date.now() - started;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", before ?? "", { timeout: 30_000 });
  await db("update public.platform_settings set open_signup = true where id");
});
