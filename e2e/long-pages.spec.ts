import { execSync } from "node:child_process";
import pg from "pg";
import { test, expect, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signIn, skipAvatarStep } from "./helpers";

/**
 * Heavy pages stay light (V1.1 phase 9): a long conversation opens on its latest messages and shows the
 * earlier ones on request; our console's companies list draws 50 rows at a time while its search looks
 * through all; the main pages fit a phone's width (no sideways scrolling).
 */
test.describe.configure({ mode: "serial" });
const run = Date.now().toString(36);
const email = `long-${run}@demo.local`;
let context: BrowserContext;
let page: Page;
let conversationId = "";

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
  context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 860 } });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

test("a long conversation opens on its latest messages; earlier ones come on request", async () => {
  await signIn(page, email);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Longue ${run}`);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await page.getByRole("button", { name: "Passer" }).click();
  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Écrivez votre message…" }).fill("Premier message");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  conversationId = page.url().split("/chat/")[1].split(/[?#]/)[0];
  const [conv] = await db<{ company_id: string; owner_id: string }>("select company_id, owner_id from public.conversations where id = $1", [conversationId]);
  // 118 more messages, numbered: 120 in all with the first question and its answer.
  await db(
    `insert into public.messages (conversation_id, company_id, seq, author_type, author_id, content, status, provider, model_id, model_label)
     select $1, $2, 10 + g, case when g % 2 = 0 then 'user' else 'assistant' end, case when g % 2 = 0 then $3::uuid else null end,
       'Message numéro ' || g, 'complete', case when g % 2 = 0 then null else 'openai'::public.ai_provider end,
       case when g % 2 = 0 then null else 'gpt-test' end, case when g % 2 = 0 then null else 'ChatGPT' end
     from generate_series(1, 118) g`,
    [conversationId, conv.company_id, conv.owner_id],
  );
  await page.reload();
  // Scoped to the page shown (the router may keep the previous page's copy hidden).
  const main = page.getByRole("main");
  // Answers are articles: half of the messages shown.
  const answers = main.locator("article");
  await expect(main.getByText("Message numéro 118", { exact: true })).toBeVisible();
  await expect(answers).toHaveCount(20);
  await expect(main.getByText("Premier message", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Afficher les messages précédents (80)" }).click();
  await expect(answers).toHaveCount(50);
  await main.getByRole("button", { name: "Afficher les messages précédents (20)" }).click();
  await expect(answers).toHaveCount(60);
  await expect(main.getByText("Premier message", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: /Afficher les messages précédents/ })).toHaveCount(0);
  // A new message still shows at the bottom.
  await page.reload();
  await page.getByRole("textbox", { name: "Écrivez votre message…" }).fill("Et maintenant ?");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(main.getByText("Et maintenant ?", { exact: true })).toBeVisible();
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(answers).toHaveCount(21);
});

test("our console's companies list draws 50 rows at a time; the search looks through all", async ({ browser }) => {
  const [{ n }] = await db<{ n: string }>("select count(*)::text as n from public.companies");
  test.skip(Number(n) <= 50, "needs more than 50 companies in the local database");
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform/companies");
  const rows = admin.getByRole("row");
  await expect(rows).toHaveCount(51);
  await expect(admin.getByText(`50 sur ${n} entreprises`)).toBeVisible();
  await admin.getByRole("button", { name: "Afficher plus" }).click();
  await expect(rows).toHaveCount(101);
  // The oldest company is far down the list, but the search finds it.
  const [oldest] = await db<{ name: string }>("select name from public.companies order by created_at asc limit 1");
  await admin.getByPlaceholder("Rechercher une entreprise ou une adresse").fill(oldest.name);
  await expect(admin.getByRole("row", { name: new RegExp(oldest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first()).toBeVisible();
  await admin.context().close();
});

test("on a phone, the main pages fit the screen's width", async ({ browser }) => {
  const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "fr-FR" });
  const mobile = await phone.newPage();
  await signIn(mobile, email);
  for (const path of ["/", "/chat", `/chat/${conversationId}`, "/memory", "/memory/import", "/apps", "/workflows", "/integrations", "/clients", "/profile", "/admin"]) {
    await mobile.goto(path);
    await expect(mobile.getByRole("main")).toBeVisible();
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  await phone.close();
});
