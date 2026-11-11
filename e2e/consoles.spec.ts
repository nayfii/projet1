import { test, expect, type Browser, type Page } from "@playwright/test";
import { shot, signIn, skipAvatarStep, openSetup } from "./helpers";

/**
 * Step 9, the consoles (CLAUDE.md §4.8, §4.9): the company overview and its to-dos, the usage
 * dashboard, the filtered activity log; our team's plan prices, usage and margins, one company's
 * detail (totals only) and provider health with a live test. AI_FAKE_PROVIDER=true.
 */
const run = Date.now().toString(36);
const owner = `consoles-owner-${run}@demo.local`;
const companyName = `Atelier Consoles ${run}`;
const planName = `Pro ${run}`;

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
});

test("setup: a company with one AI answer", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(companyName);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(page);
  await expect(page.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await openSetup(page, "invite");
  await expect(page.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await openSetup(page, "client");
  await page.getByLabel("Nom du client").fill("Client A");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await openSetup(page, "document");
  await expect(page.getByRole("heading", { name: "Votre premier document" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();

  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Écrivez votre message…" }).fill("Donne-moi trois idées de titre pour notre lettre d'information.");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.locator("article")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
});

test("the overview lists what needs the boss's attention", async () => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Vue d'ensemble" })).toBeVisible();
  await expect(page.getByText("Crédits vidéo ce mois-ci")).toBeVisible();
  await expect(page.getByRole("heading", { name: "À faire" })).toBeVisible();
  await expect(page.getByText("Rien à signaler pour l'instant.")).toBeVisible();
  await shot(page, "100-admin-overview");
});

test("the usage dashboard shows credits by day, feature, person and model", async () => {
  await page.goto("/admin/usage");
  await expect(page.getByText("Crédits IA utilisés")).toBeVisible();
  await expect(page.getByRole("img", { name: /Graphique : Crédits par jour/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Par fonction" })).toBeVisible();
  await expect(page.getByText("Conversations et outils")).toBeVisible();
  await expect(page.getByRole("main").getByText("Claire Martin")).toBeVisible();
  await shot(page, "101-admin-usage");
});

test("the activity log filters by type, person and period", async () => {
  await page.goto("/admin/activity");
  await page.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Accès et équipe" }).click();
  await expect(page).toHaveURL(/category=access/);
  await expect(page.getByText("a créé l'espace de l'entreprise")).toBeVisible();
  await page.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Vidéo" }).click();
  await expect(page.getByText("Aucun événement ne correspond à ces filtres.")).toBeVisible();
  await page.getByRole("combobox", { name: "Période" }).click();
  await page.getByRole("option", { name: "7 derniers jours" }).click();
  await expect(page).toHaveURL(/period=7/);
  await page.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Tout" }).click();
  await expect(page.getByText("a créé l'espace de l'entreprise")).toBeVisible();
  await shot(page, "102-admin-activity");
});

test("our team prices a plan, then sees revenue, AI cost and margin per company", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");

  await admin.goto("/platform/plans");
  await admin.getByRole("button", { name: "Nouvelle offre" }).click();
  await admin.getByLabel("Nom").fill(planName);
  await admin.getByLabel("Prix mensuel par place").fill("35");
  await admin.getByLabel("Crédits / mois").fill("20000");
  await admin.getByRole("button", { name: "Enregistrer" }).click();
  await expect(admin.getByText("Offre enregistrée")).toBeVisible();
  await expect(admin.getByText("35,00 € par place et par mois").first()).toBeVisible();
  await shot(admin, "103-platform-plan-price");

  await admin.goto("/platform/companies");
  const row = admin.getByRole("row").filter({ hasText: companyName });
  await row.getByRole("combobox").first().click();
  await admin.getByRole("option", { name: planName }).click();
  await expect(admin.getByText("Modification enregistrée")).toBeVisible();

  await admin.goto("/platform/usage");
  await expect(admin.getByRole("heading", { name: "Consommation", exact: true })).toBeVisible();
  await admin.getByLabel("Taux de change").fill("0,92");
  await admin.getByRole("button", { name: "Enregistrer" }).click();
  await expect(admin.getByText("Taux de change enregistré.")).toBeVisible();
  const usage = admin.getByRole("row").filter({ hasText: companyName });
  await expect(usage).toContainText(planName);
  await expect(usage).toContainText("35 €");
  await shot(admin, "104-platform-usage");

  await usage.getByRole("link", { name: companyName }).click();
  await expect(admin.getByRole("heading", { name: companyName })).toBeVisible();
  await expect(admin.getByRole("img", { name: /Graphique : Coût IA estimé par jour/ })).toBeVisible();
  await expect(admin.getByText(/Totaux uniquement/)).toBeVisible();
  // Never per person: the owner's name does not appear.
  await expect(admin.getByRole("main").getByText("Claire Martin")).toHaveCount(0);
  await shot(admin, "105-platform-company");
  await admin.context().close();
});

test("provider health in test mode: says so, and never claims a provider works", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform/health");
  await expect(admin.getByRole("heading", { name: "Fournisseurs", exact: true })).toBeVisible();
  await expect(admin.getByTestId("test-mode")).toContainText("aucune vraie IA n'est appelée");
  // Only real keys count: a provider without one is "not configured", whatever the simulated answers.
  for (const id of ["openai", "anthropic", "google"]) {
    const card = admin.getByTestId(`provider-${id}`);
    await expect(card.getByText(/^(Non configuré|Mode test · clé présente)$/)).toBeVisible();
    const button = card.getByRole("button", { name: /^Tester .* maintenant$/ });
    if (await button.count()) await expect(button).toBeDisabled();
  }
  await expect(admin.getByTestId("render-queue")).toBeVisible();
  // "Test each model" says plainly when the platform runs in test mode (no real AI is called).
  await admin.getByRole("button", { name: "Tester chaque modèle" }).click();
  await expect(admin.getByText(/Mode test activé \(AI_FAKE_PROVIDER\) : aucune vraie IA n'est appelée\. Retirez/)).toBeVisible();
  await shot(admin, "106-platform-health");
  await admin.context().close();
});

test("our console opens on the morning dashboard, with shortcuts, and no way into a company space", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform");
  await expect(admin.getByRole("heading", { name: /^Bonjour/ })).toBeVisible();
  const kpis = admin.getByTestId("dashboard-kpis");
  for (const label of ["Entreprises actives", "Personnes actives aujourd'hui", "Demandes à l'IA aujourd'hui", "Coût IA ce mois (estimé)"]) {
    await expect(kpis.getByText(label)).toBeVisible();
  }
  const vercel = admin.getByTestId("deck-tools").getByRole("link", { name: /Vercel/ });
  await expect(vercel).toHaveAttribute("target", "_blank");
  await expect(admin.getByRole("link", { name: "Nouveau client" })).toHaveAttribute("href", "/platform/companies?new=1");
  await expect(admin.getByRole("link", { name: "Mon espace entreprise" })).toHaveCount(0);
  await shot(admin, "107-platform-home");
  await admin.context().close();
});

test("a suspended company sees the pause screen; once reactivated, a reload brings its people back in", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  await signIn(admin, "platform@demo.local");
  await admin.goto("/platform/companies");
  await admin.getByPlaceholder("Rechercher une entreprise ou une adresse").fill(companyName);
  const row = admin.getByRole("row", { name: new RegExp(companyName) });
  await row.getByRole("button", { name: "Suspendre" }).click();
  await expect(row.getByText("Suspendue", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(/\/suspended$/);
  await expect(page.getByRole("heading", { name: "Accès en pause" })).toBeVisible();

  await row.getByRole("button", { name: "Réactiver" }).click();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  // The person was left on the pause screen: reloading it opens the workspace again.
  await page.reload();
  await expect(page).not.toHaveURL(/\/suspended$/);
  await expect(page.getByRole("heading", { name: "Accès en pause" })).toHaveCount(0);
  await admin.context().close();
});
