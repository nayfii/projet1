import { test, expect as baseExpect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import pg from "pg";
import { shot, signIn } from "./helpers";

/**
 * Studio (founder's request, 2026-11-11): Scale rebuilt as four connected sections. The founder's
 * morning: Workspace → Studio, the Overview, a task and its document, done, the milestone moves on,
 * the Roadmap, the library. Each piece of information is created once and shown everywhere.
 */
test.describe.configure({ mode: "serial" });
// First visits of a page can take a few seconds to prepare (development server).
const expect = baseExpect.configure({ timeout: 15_000 });
let page: Page;
const run = Date.now().toString(36);

async function db<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const status = JSON.parse(execSync("supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString()) as { DB_URL: string };
  const client = new pg.Client({ connectionString: status.DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const panel = () => page.getByTestId("studio-panel");
const main = () => page.locator("main");
async function closePanel() {
  await panel().getByRole("button", { name: "Fermer le panneau" }).click();
  await expect(panel()).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  // Studio holds our team's own data: each run starts from an empty space (local database only).
  await db(
    "truncate public.scale_tasks, public.scale_milestones, public.scale_documents, public.scale_projects, public.scale_objectives, public.scale_tests, public.scale_decisions, public.scale_metrics, public.scale_simulations, public.scale_weekly_reviews, public.scale_activity cascade",
  );
  await db("delete from public.scale_categories where key is null");
  await db("update public.scale_categories set name = null, icon = case key when 'strategy' then 'compass' else icon end");
  page = await (await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(page, "platform@demo.local");
});

test("the console keeps everything it had; the Workspace | Studio switch takes us to Studio", async () => {
  await page.goto("/platform/companies");
  const nav = page.getByRole("navigation", { name: "Navigation" });
  await expect(nav.getByRole("link")).toHaveText(["Accueil", "Entreprises", "Offres", "Équipe", "Applis", "Versions", "Aperçu", "Debug", "Consommation", "Fournisseurs", "Modèles et tarifs", "Journal"]);
  const spaces = page.getByRole("navigation", { name: "Espaces de notre équipe" });
  await expect(spaces.locator("[aria-current=page]")).toHaveText("Workspace");
  await shot(page, "studio-01-console");
  await spaces.getByRole("link", { name: "Studio" }).click();
  await expect(page.getByRole("heading", { name: "Cendr Studio", level: 1 })).toBeVisible();
  await expect(page.getByText("Voici ce qui compte aujourd'hui.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Espaces de notre équipe" }).locator("[aria-current=page]")).toHaveText("Studio");
  // Nothing is invented: an empty Studio says so, with the way to start.
  await expect(page.getByTestId("indicator-high")).toContainText("Aucune tâche pour l'instant");
  await expect(page.getByTestId("indicator-roadmap")).toContainText("Aucun jalon pour l'instant");
  await expect(page.getByText("Aucune tâche pour l'instant.")).toBeVisible();
  await shot(page, "studio-02-empty");
});

test("four sections in the menu, and the old Scale addresses lead to Studio", async () => {
  const menu = page.getByRole("navigation", { name: "Navigation de Studio" });
  await expect(menu.getByRole("link")).toHaveText(["Overview", "Tasks", "Roadmap", "Knowledge"]);
  await page.goto("/scale/projects");
  await expect(page).toHaveURL(/\/studio\/roadmap$/);
  await page.goto("/scale");
  await expect(page).toHaveURL(/\/studio$/);
});

test("a milestone from the quick actions, then tasks added with a title and Enter", async () => {
  await page.getByRole("button", { name: "Nouveau jalon" }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom du jalon").fill("Valider l'ICP");
  await dialog.locator("input[type=date]").fill("2026-12-15");
  await dialog.getByRole("button", { name: "Catégorie" }).click();
  await page.getByRole("menuitem", { name: "Stratégie" }).click();
  await dialog.getByRole("button", { name: "Ajouter le jalon" }).click();
  await expect(page.getByText("Jalon ajouté.")).toBeVisible();
  await expect(page.getByTestId("indicator-next")).toContainText("Valider l'ICP");

  await page.getByRole("navigation", { name: "Navigation de Studio" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  await expect(page.getByText("Aucune tâche pour l'instant")).toBeVisible();
  await main().getByRole("button", { name: "Ajouter une tâche" }).first().click();
  await page.getByRole("dialog").getByLabel("Titre de la tâche").fill("Finaliser l'ICP");
  await page.getByRole("dialog").getByRole("button", { name: "Priorité" }).click();
  await page.getByRole("menuitem", { name: "Haute" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Jalon" }).click();
  await page.getByRole("menuitem", { name: /Valider l'ICP/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Ajouter la tâche" }).click();
  await expect(main().getByRole("region", { name: "Haute" }).getByText("Finaliser l'ICP")).toBeVisible();

  // Quick add in a group: Enter adds, the field stays ready for the next one.
  await main().getByRole("button", { name: "Ajouter — Priorité haute" }).click();
  const field = page.getByLabel("Nouvelle tâche — Priorité haute");
  await field.fill("Interviewer cinq agences");
  await field.press("Enter");
  await field.fill("Relire le pricing");
  await field.press("Enter");
  await field.press("Escape");
  await expect(main().getByRole("region", { name: "Haute" }).locator("[data-task-row]")).toHaveCount(3);
  await shot(page, "studio-03-tasks");
});

test("dragging a task to another group changes its priority", async () => {
  const row = main().locator("[data-task-row]").filter({ hasText: "Relire le pricing" });
  await row.dragTo(main().getByRole("region", { name: "Basse" }));
  await expect(main().getByRole("region", { name: "Basse" }).getByText("Relire le pricing")).toBeVisible();
  await expect.poll(async () => (await db<{ priority: string }>("select priority from public.scale_tasks where title = 'Relire le pricing'"))[0]?.priority).toBe("low");
});

test("a task's panel: details, its milestone, and a document created from it", async () => {
  await main().getByRole("button", { name: /Interviewer cinq agences/ }).click();
  await expect(panel()).toBeVisible();
  await panel().getByRole("button", { name: "Jalon" }).click();
  await page.getByRole("menuitem", { name: /Valider l'ICP/ }).click();
  await panel().getByLabel("Description").fill("Agences de 10 à 25 personnes, pas de vente.");
  await panel().getByLabel("Description").blur();
  await closePanel();

  await main().getByRole("button", { name: /Finaliser l'ICP/ }).click();
  await panel().getByRole("button", { name: "Nouveau document" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Titre du document").fill("ICP — Ideal Customer Profile");
  await dialog.getByRole("button", { name: "Catégorie" }).click();
  await page.getByRole("menuitem", { name: "Stratégie" }).click();
  await dialog.getByRole("button", { name: "Créer et ouvrir" }).click();
  await expect(page).toHaveURL(/\/studio\/knowledge\/[0-9a-f-]{36}/);
  await expect(page.getByLabel("Titre du document")).toHaveValue("ICP — Ideal Customer Profile");
  const first = page.getByLabel("Texte").first();
  await first.click();
  await first.pressSequentially("Cible : agences de communication de 10 à 25 personnes.");
  await first.press("Enter");
  await page.keyboard.type("## ");
  await page.keyboard.type("Pourquoi elles");
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible();
  // The document knows the task it goes with.
  await expect(page.getByRole("region", { name: "Lié à" }).getByText("Finaliser l'ICP")).toBeVisible();
  await shot(page, "studio-04-document");
});

test("finishing the task from the Overview moves the milestone on, everywhere", async () => {
  await page.getByRole("navigation", { name: "Navigation de Studio" }).getByRole("link", { name: "Overview" }).click();
  const focus = page.getByTestId("focus-list");
  await expect(focus.getByText("Finaliser l'ICP")).toBeVisible();
  await expect(page.getByTestId("indicator-high")).toContainText("2");
  await shot(page, "studio-05-overview");
  // The task's panel shows its document; it opens in Knowledge.
  await focus.getByRole("button", { name: /Finaliser l'ICP/ }).click();
  await expect(panel().getByRole("link", { name: "ICP — Ideal Customer Profile" })).toBeVisible();
  await closePanel();
  await focus.getByRole("checkbox", { name: "Terminer « Finaliser l'ICP »" }).click();
  await expect(page.getByText("Tâche terminée.")).toBeVisible();
  await expect(focus.getByText("Finaliser l'ICP")).toHaveCount(0);
  await expect(page.getByTestId("indicator-done")).toContainText("1");
  await expect(page.getByTestId("indicator-high")).toContainText("1");

  await page.getByTestId("indicator-next").click();
  await expect(panel().getByText("1 sur 2 tâches terminées")).toBeVisible();
  await expect(panel().getByText("50%")).toBeVisible();
  await closePanel();
});

test("the roadmap shows the milestone at its date with its progress; dragging changes the date", async () => {
  await page.goto("/studio/roadmap");
  const card = page.locator("[data-milestone]").filter({ hasText: "Valider l'ICP" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1/2");
  await expect(card).toContainText("15 déc.");
  await shot(page, "studio-06-roadmap");
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + 140, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  // 100 px at 10 px a day: ten days later. Its tasks keep their own dates.
  await expect.poll(async () => (await db<{ d: string }>("select target_date::text as d from public.scale_milestones where title = 'Valider l''ICP'"))[0]?.d).toBe("2026-12-25");
  await page.getByRole("tab", { name: "Liste" }).click();
  await expect(page.getByRole("region", { name: /décembre 2026/i }).getByText("Valider l'ICP")).toBeVisible();
  await page.getByRole("tab", { name: "Frise" }).click();
});

test("a milestone without a date waits in To schedule; a new one is placed by dropping it", async () => {
  await page.getByRole("button", { name: "Nouveau jalon" }).first().click();
  await page.getByRole("dialog").getByLabel("Nom du jalon").fill(`Premiers pilotes ${run}`);
  await page.getByRole("dialog").getByRole("button", { name: "Ajouter le jalon" }).click();
  const chip = page.getByRole("button", { name: `Premiers pilotes ${run} — à planifier` });
  await expect(chip).toBeVisible();
  await chip.dragTo(page.getByTestId("roadmap-timeline"), { targetPosition: { x: 600, y: 80 } });
  await expect(page.locator("[data-milestone]").filter({ hasText: `Premiers pilotes ${run}` })).toBeVisible();
});

test("Knowledge: categories, search by title, by content and with a typo", async () => {
  await page.goto("/studio/knowledge");
  await expect(page.getByRole("heading", { name: "Knowledge", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Stratégie\s*1 document/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Ouverts récemment" }).getByText("ICP — Ideal Customer Profile")).toBeVisible();
  const search = page.getByLabel("Rechercher n'importe quoi sur Cendr…");
  await search.fill("ICP");
  await expect(page.getByRole("option", { name: /ICP — Ideal Customer Profile/ })).toBeVisible();
  // Inside the text, and forgiving a typo.
  await search.fill("comunication");
  await expect(page.getByRole("option", { name: /ICP — Ideal Customer Profile/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /ICP — Ideal Customer Profile/ })).toContainText("agences de communication");
  await search.fill("");
  await shot(page, "studio-07-knowledge");
});

test("a new category, a document in it that links to another one", async () => {
  await main().getByRole("button", { name: "Nouvelle catégorie" }).first().click();
  await page.getByRole("dialog").getByLabel("Nom de la catégorie").fill(`Investisseurs ${run}`);
  await page.getByRole("dialog").getByRole("radio", { name: "rocket" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click();
  await page.getByRole("link", { name: new RegExp(`Investisseurs ${run}`) }).click();
  await expect(page.getByRole("heading", { name: `Investisseurs ${run}`, level: 1 })).toBeVisible();
  await expect(page.getByText("Aucun document dans cette catégorie.")).toBeVisible();
  await main().getByRole("button", { name: "Nouveau document" }).first().click();
  await page.getByRole("dialog").getByLabel("Titre du document").fill("Go-to-Market Strategy");
  await page.getByRole("dialog").getByRole("button", { name: "Créer et ouvrir" }).click();
  await expect(page.getByLabel("Titre du document")).toHaveValue("Go-to-Market Strategy");
  const text = page.getByLabel("Texte").first();
  await text.click();
  await text.pressSequentially("On commence par l'");
  await page.keyboard.type("[[ICP");
  await page.getByRole("listbox", { name: "Lien vers un document" }).getByRole("option", { name: /ICP — Ideal Customer Profile/ }).click();
  await page.keyboard.type(" puis on teste les canaux.");
  // Bold from the formatting bar on a selection.
  await page.getByLabel("Titre du document").click();
  await expect(main().getByRole("link", { name: "ICP — Ideal Customer Profile" })).toBeVisible();
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible();
  await shot(page, "studio-08-link");
  await main().getByRole("link", { name: "ICP — Ideal Customer Profile" }).click();
  await expect(page.getByLabel("Titre du document")).toHaveValue("ICP — Ideal Customer Profile");
  await expect(page.getByRole("region", { name: "Mentionné dans" }).getByText("Go-to-Market Strategy")).toBeVisible();
});

test("⌘K finds a task, a milestone or a document and opens it", async () => {
  await page.keyboard.press("Control+k");
  const input = page.getByLabel("Rechercher, créer, aller à…");
  await input.fill("intervewer");
  await expect(page.getByRole("option", { name: /Interviewer cinq agences/ })).toBeVisible();
  await input.press("Enter");
  await expect(panel().getByLabel("Titre")).toHaveValue("Interviewer cinq agences");
  await closePanel();
});

test("everything is kept after a reload; the board moves a task to In progress; the history keeps done tasks", async () => {
  await page.goto("/studio/tasks");
  await page.reload();
  await expect(main().getByText("Interviewer cinq agences")).toBeVisible();
  await page.getByRole("tab", { name: "Tableau" }).click();
  const card = main().getByRole("listitem").filter({ hasText: "Interviewer cinq agences" });
  await card.dragTo(main().getByRole("region", { name: "En cours" }));
  await expect(main().getByRole("region", { name: "En cours" }).getByText("Interviewer cinq agences")).toBeVisible();
  await expect.poll(async () => (await db<{ status: string }>("select status from public.scale_tasks where title = 'Interviewer cinq agences'"))[0]?.status).toBe("in_progress");
  await shot(page, "studio-09-board");
  await page.getByRole("tab", { name: "Historique" }).click();
  await expect(main().getByText("Finaliser l'ICP")).toBeVisible();
  await page.getByRole("tab", { name: "Liste" }).click();
});

test("on a phone: the menu, the switch, and no page scrolls sideways", async ({ browser }) => {
  const phone = await (await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() })).newPage();
  await phone.goto("/studio");
  await phone.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(phone.getByRole("navigation", { name: "Espaces de notre équipe" }).filter({ visible: true })).toBeVisible();
  await phone.getByRole("link", { name: "Roadmap" }).filter({ visible: true }).click();
  await expect(phone.getByRole("heading", { name: "Roadmap", level: 1 })).toBeVisible();
  for (const path of ["/studio", "/studio/tasks", "/studio/roadmap", "/studio/knowledge"]) {
    await phone.goto(path);
    await expect(phone.locator("main h1").first()).toBeVisible();
    const width = await phone.evaluate(() => document.documentElement.scrollWidth);
    expect(width, `${path} fits the phone`).toBeLessThanOrEqual(390);
  }
  await shot(phone, "studio-10-phone");
  await phone.context().close();
});

test("anyone outside our team gets nothing", async ({ browser }) => {
  const other = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(other, `studio-outsider-${run}@demo.local`);
  const res = await other.goto("/studio");
  expect(res?.status()).toBe(404);
  await other.context().close();
});
