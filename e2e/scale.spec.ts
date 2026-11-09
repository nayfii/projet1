import { test, expect as baseExpect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import pg from "pg";
import { shot, signIn } from "./helpers";

/**
 * Scale (founder's request, 2026-11-09): a separate space of our console to grow Cendr. The console
 * stays as it was, with one more link; Scale's records are shared by every view, saved, and for our
 * team only.
 */
test.describe.configure({ mode: "serial" });
// First visits of a page can take a few seconds to prepare.
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

const panel = () => page.locator("[data-scale-panel]");
async function closePanel() {
  await panel().getByRole("button", { name: "Fermer" }).click();
  await expect(panel()).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  // Scale holds our team's own data: each run starts from an empty space (local database only).
  await db(
    "truncate public.scale_settings, public.scale_objectives, public.scale_projects, public.scale_tasks, public.scale_tests, public.scale_documents, public.scale_decisions, public.scale_metrics, public.scale_simulations, public.scale_weeks, public.scale_weekly_reviews, public.scale_company_links, public.scale_comments, public.scale_attachments, public.scale_activity, public.scale_saved_views cascade",
  );
  // A customer company to link to (an existing one is enough: Scale never copies it).
  const [company] = await db<{ name: string }>("select name from public.companies group by name having count(*) = 1 order by min(created_at) limit 1");
  expect(company, "the local database holds at least one customer company").toBeTruthy();
  page = await (await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(page, "platform@demo.local");
});

test("our console is unchanged, with one more link: Scale", async () => {
  await page.goto("/platform/companies");
  const nav = page.getByRole("navigation", { name: "Navigation" });
  await expect(nav.getByRole("link")).toHaveText(["Accueil", "Entreprises", "Offres", "Équipe", "Applis", "Versions", "Aperçu", "Debug", "Consommation", "Fournisseurs", "Modèles et tarifs", "Journal"]);
  await expect(page.getByRole("link", { name: "Scale", exact: true })).toBeVisible();
  await shot(page, "scale-01-console");
});

test("first visit: Scale opens on purpose, explains itself, and starts with the Cendr structure", async () => {
  await page.getByRole("link", { name: "Scale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bienvenue dans Scale" })).toBeVisible();
  // The active space is shown, and the way back too.
  await expect(page.getByRole("navigation", { name: "Espaces de la console" }).locator("[aria-current=page]")).toHaveText("Scale");
  await expect(page.getByRole("link", { name: "Retour à la Plateforme" })).toBeVisible();
  await page.getByLabel("Temps disponible par semaine (heures)").fill("2");
  await page.getByRole("button", { name: "Commencer avec la structure Cendr" }).click();
  await expect(page.getByRole("heading", { name: "Où en est Cendr" })).toBeVisible();
  await expect(page.getByText("Définir et valider l'ICP").first()).toBeVisible();
  await shot(page, "scale-02-overview");
});

test("going back to the console lands on the page left, and Scale comes back where it was", async () => {
  await page.getByRole("link", { name: "Projets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projets", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Retour à la Plateforme" }).click();
  await expect(page).toHaveURL(/\/platform\/companies$/);
  await page.getByRole("link", { name: "Scale", exact: true }).click();
  await expect(page).toHaveURL(/\/scale\/projects$/);
});

test("an objective, a project, a milestone and linked tasks", async () => {
  await page.goto("/scale/roadmap");
  await page.getByRole("tab", { name: "Objectifs" }).click();
  await page.getByLabel("Nouvel objectif…").fill(`Cinq pilotes actifs ${run}`);
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(panel().getByLabel("Titre")).toHaveValue(`Cinq pilotes actifs ${run}`);
  await closePanel();

  await page.goto("/scale/projects");
  await page.getByLabel("Nouveau projet").fill(`Projet E2E ${run}`);
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await expect(page).toHaveURL(/\/scale\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Objectif" }).click();
  await page.getByRole("menuitem", { name: `Cinq pilotes actifs ${run}` }).click();
  await page.getByLabel("Ajouter un jalon").fill("Jalon E2E");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Jalon E2E", exact: true })).toBeVisible();
  const add = page.getByLabel("Ajouter une tâche").first();
  await add.fill("Tâche A");
  await add.press("Enter");
  await expect(page.getByRole("button", { name: "Tâche A", exact: true })).toBeVisible();
  await add.fill("Tâche B");
  await add.press("Enter");
  await expect(page.getByRole("button", { name: "Tâche B", exact: true })).toBeVisible();
  await shot(page, "scale-03-project");
});

test("a status changed in the Kanban shows in the list, and survives a reload", async () => {
  await page.goto("/scale/projects");
  await page.getByRole("tab", { name: "Tâches" }).click();
  await page.getByRole("tab", { name: "Kanban" }).click();
  const card = page.locator("article").filter({ hasText: "Tâche A" });
  await card.getByRole("button", { name: "Statut : À faire" }).click();
  await page.getByRole("menuitem", { name: "En cours" }).click();
  await expect(page.getByRole("region", { name: "En cours" }).getByText("Tâche A")).toBeVisible();
  await shot(page, "scale-04-kanban");
  await page.getByRole("tab", { name: "Liste" }).click();
  await expect(page.getByRole("region", { name: "En cours" }).getByRole("button", { name: "Tâche A", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "En cours" }).getByRole("button", { name: "Tâche A", exact: true })).toBeVisible();
});

test("a dependency blocks a task, and a loop is refused", async () => {
  await page.getByRole("button", { name: "Tâche B", exact: true }).click();
  await panel().getByRole("button", { name: "Ajouter une dépendance" }).click();
  await page.getByRole("menuitem", { name: "Tâche A" }).click();
  await expect(panel().getByText("En attente de : Tâche A")).toBeVisible();
  // The other way round would close a loop: offered, but disabled.
  await closePanel();
  await page.getByRole("button", { name: "Tâche A", exact: true }).click();
  await panel().getByRole("button", { name: "Ajouter une dépendance" }).click();
  await expect(page.getByRole("menuitem", { name: /Tâche B/ })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await closePanel();
  await page.goto("/scale");
  await expect(page.getByRole("region", { name: "À débloquer" }).getByText("Tâche B")).toBeVisible();
});

test("weekly capacity against estimates: an overload is shown", async () => {
  await page.goto("/scale/projects");
  await page.getByRole("tab", { name: "Tâches" }).click();
  await page.getByRole("tab", { name: "Liste" }).click();
  await page.getByRole("button", { name: "Tâche A", exact: true }).click();
  await panel().getByRole("button", { name: "Non planifiée" }).click();
  await page.getByRole("menuitem", { name: "Cette semaine" }).click();
  await panel().getByLabel("Estimation", { exact: true }).fill("3");
  await panel().getByLabel("Estimation", { exact: true }).press("Enter");
  await closePanel();
  await page.goto("/scale");
  const week = page.getByRole("region", { name: "Cette semaine" });
  // 3 h for the task + 0.5 h for the weekly review routine of the Cendr structure.
  await expect(week.getByText("Dépassement de 1,5 h")).toBeVisible();
  await expect(week.getByText("2 h disponibles")).toBeVisible();
  await shot(page, "scale-05-week");
});

test("a test with results and a conclusion kept apart from its status, linked to an existing customer", async () => {
  await page.goto("/scale/tests");
  await page.getByRole("button", { name: "Nouveau test" }).first().click();
  await page.getByRole("menuitem", { name: /Entretien de découverte ICP/ }).click();
  await expect(page).toHaveURL(/\/scale\/tests\/[0-9a-f-]{36}$/);
  await page.getByLabel("Hypothèse", { exact: true }).fill("Les agences de 10 à 25 salariés réexpliquent souvent le contexte client.");
  await page.getByLabel("Résultats", { exact: true }).fill("7 entretiens sur 10 citent le problème spontanément.");
  await page.getByLabel("Résultats", { exact: true }).blur();
  await page.getByRole("button", { name: "Statut" }).click();
  await page.getByRole("menuitem", { name: "Terminé" }).click();
  await expect(page.getByText("Ce test est terminé mais n'a pas encore de conclusion.")).toBeVisible();
  await page.getByRole("radio", { name: "Hypothèse soutenue" }).click();
  await expect(page.getByRole("radio", { name: "Hypothèse soutenue" })).toHaveAttribute("aria-checked", "true");

  // An existing customer company, linked by its id: offered once, never duplicated.
  const [company] = await db<{ name: string }>("select name from public.companies group by name having count(*) = 1 order by min(created_at) limit 1");
  await page.getByRole("button", { name: "Relier un client" }).click();
  await page.getByLabel("Chercher un client…").fill(company.name);
  await page.getByRole("menuitem", { name: company.name }).first().click();
  await expect(page.getByRole("button", { name: company.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Relier un client" }).click();
  await page.getByLabel("Chercher un client…").fill(company.name);
  await expect(page.getByRole("menuitem", { name: company.name, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const rows = await db<{ n: number }>("select count(*)::int as n from public.scale_company_links where entity_type = 'test'");
  expect(rows[0].n).toBe(1);

  // From the result: a decision already linked to the test.
  await page.getByRole("button", { name: "Créer une décision" }).click();
  await expect(panel().getByLabel("Sujet")).toHaveValue(/Suite du test/);
  await closePanel();
  await shot(page, "scale-06-test");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Hypothèse soutenue" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Résultats", { exact: true })).toHaveValue("7 entretiens sur 10 citent le problème spontanément.");
});

test("a document is saved automatically and opens again", async () => {
  await page.goto("/scale/strategy");
  // Clicked again until the page is ready to answer (first visit of the page).
  await expect(async () => {
    await page.getByRole("button", { name: "Nouveau document" }).click();
    await baseExpect(page.getByRole("button", { name: /^Compte rendu/ })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await page.getByRole("button", { name: /^Compte rendu/ }).click();
  await expect(page).toHaveURL(/\/scale\/strategy\/[0-9a-f-]{36}$/);
  await page.getByLabel("Titre du document").fill(`Réunion pilote ${run}`);
  await page.getByRole("button", { name: "Ajouter un bloc", exact: true }).click();
  const last = page.getByLabel("Texte").last();
  await last.fill("Point clé : le client veut un essai de deux semaines.");
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" }).first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1200);
  await shot(page, "scale-07-document");
  await page.reload();
  await expect(page.getByLabel("Titre du document")).toHaveValue(`Réunion pilote ${run}`);
  await expect(page.getByText("Point clé : le client veut un essai de deux semaines.")).toBeVisible();
});

test("search finds an item and opens it", async () => {
  await page.goto("/scale");
  await expect(async () => {
    await page.keyboard.press("/");
    await baseExpect(page.getByRole("combobox", { name: "Rechercher dans Scale" })).toBeVisible({ timeout: 1500 });
  }).toPass();
  await page.getByRole("combobox", { name: "Rechercher dans Scale" }).fill("Tâche A");
  await expect(page.getByRole("option", { name: /Tâche A/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(panel().getByLabel("Titre")).toHaveValue("Tâche A");
  await closePanel();
});

test("archive, then restore", async () => {
  await page.goto("/scale/projects");
  await page.getByRole("tab", { name: "Tâches" }).click();
  await page.getByRole("tab", { name: "Liste" }).click();
  await page.getByRole("button", { name: "Actions pour Tâche B" }).click();
  await page.getByRole("menuitem", { name: "Archiver" }).click();
  await expect(page.getByRole("button", { name: /^Tâche B( En attente)?$/ })).toHaveCount(0);
  await page.goto("/scale/archive");
  await expect(page.getByText("Tâche B")).toBeVisible();
  await expect(async () => {
    await page.getByRole("listitem").filter({ hasText: "Tâche B" }).getByRole("button", { name: "Restaurer" }).click({ timeout: 2000 });
    await baseExpect(page.getByText("Rien d'archivé.")).toBeVisible({ timeout: 3000 });
  }).toPass();
  await page.goto("/scale/projects");
  await expect(page.getByRole("button", { name: /^Tâche B( En attente)?$/ })).toBeVisible();
});

test("indicators show no invented value, and a failed save keeps the input with a way to retry", async () => {
  await page.goto("/scale/metrics");
  await expect(page.getByRole("button", { name: /Clients payants/ }).getByText("Non renseigné")).toBeVisible();
  await page.goto("/scale/projects");
  await page.getByRole("tab", { name: "Tâches" }).click();
  // The network refuses the next saves.
  await page.route("**/*", (route) => (route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort() : route.continue()));
  await page.getByRole("region", { name: "En cours" }).getByRole("button", { name: "Statut : En cours" }).click();
  await page.getByRole("menuitem", { name: "Bloqué" }).click();
  await expect(page.getByText("L'enregistrement a échoué. Votre saisie est conservée.")).toBeVisible();
  await expect(page.getByText("Échec de l'enregistrement")).toBeVisible();
  await page.unroute("**/*");
  await page.getByRole("button", { name: "Réessayer" }).first().click();
  await expect(page.getByRole("region", { name: "Bloqué" }).getByRole("button", { name: "Tâche A", exact: true })).toBeVisible();
});

test("keyboard: capture, move between sections, close", async () => {
  await page.goto("/scale");
  await expect(page.getByRole("heading", { name: "Où en est Cendr" })).toBeVisible();
  await expect(async () => {
    await page.keyboard.press("c");
    await baseExpect(page.getByRole("heading", { name: "Capture rapide" })).toBeVisible({ timeout: 1500 });
  }).toPass();
  await page.getByLabel("Titre", { exact: true }).fill(`Idée ${run}`);
  await page.getByRole("tab", { name: "Idée" }).click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Capture rapide" })).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/scale\/tests$/);
});

test("small screen: the space name, the menu and the way back", async ({ browser }) => {
  const phone = await (await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() })).newPage();
  await phone.goto("/scale");
  await expect(phone.getByText("Développement de Cendr").filter({ visible: true }).first()).toBeVisible();
  await phone.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(phone.getByRole("link", { name: "Retour à la Plateforme" })).toBeVisible();
  await phone.getByRole("link", { name: "Roadmap" }).click();
  await expect(phone.getByRole("heading", { name: "Roadmap" })).toBeVisible();
  // No page of Scale scrolls sideways on a phone.
  for (const path of ["/scale", "/scale/roadmap", "/scale/projects", "/scale/tests", "/scale/strategy", "/scale/metrics", "/scale/archive", "/scale/settings"]) {
    await phone.goto(path);
    await expect(phone.locator("main h1").first()).toBeVisible();
    const width = await phone.evaluate(() => document.documentElement.scrollWidth);
    expect(width, path).toBeLessThanOrEqual(390);
  }
  await shot(phone, "scale-08-phone");
  await phone.context().close();
});

test("anyone outside our team gets nothing: no page, no data, no export", async ({ browser }) => {
  const other = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(other, `scale-outsider-${run}@demo.local`);
  await expect(other.getByLabel("Votre nom")).toBeVisible();
  const scale = await other.goto("/scale");
  expect(scale?.status()).toBe(404);
  const projects = await other.goto("/scale/projects");
  expect(projects?.status()).toBe(404);
  const exported = await other.request.get("/api/scale/export?format=json");
  expect(exported.status()).toBe(403);
  await other.context().close();
});
