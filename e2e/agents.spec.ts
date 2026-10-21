import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { shot, signIn } from "./helpers";

/**
 * Step 7, the launch agents (CLAUDE.md §4.7): the library by department, agents run as forms (with files),
 * Word/PDF/Excel/CSV exports, charts with their data table, notices, and the company's adaptations.
 * AI_FAKE_PROVIDER=true: answers are simulated ("[TEST]"), with a sample table and chart when asked.
 */
const run = Date.now().toString(36);
const owner = `agents-owner-${run}@demo.local`;

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await (await browser.newContext({ locale: "fr-FR", acceptDownloads: true })).newPage();
});

const answers = () => page.locator("article");

async function waitForAnswer() {
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(answers()).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
  return answers().last();
}

async function openAgent(name: string) {
  await page.goto("/library");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function download(answer: ReturnType<Page["locator"]>, label: string) {
  await answer.getByRole("button", { name: "Exporter" }).click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test("setup: a company and Client A", async () => {
  await signIn(page, owner);
  await page.getByLabel("Votre nom").fill("Claire Martin");
  await page.getByLabel("Nom de l'entreprise").fill(`Atelier Agents ${run}`);
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
});

test("the library holds the 14 agents by department; the video agents come later", async () => {
  await page.goto("/library");
  const expected: Record<string, string[]> = {
    Ventes: ["Proposition commerciale", "Préparation de rendez-vous"],
    Comptabilité: ["Saisie de factures", "Relances de paiement"],
    Finance: ["Prévision de trésorerie", "Analyse de marge"],
    "Ressources humaines": ["Offre d'emploi", "Aide à la lecture de candidatures"],
    Juridique: ["Relecture de contrat", "Modèles juridiques"],
    "Service client": ["Réponse aux e-mails", "Synthèse des retours"],
    Direction: ["Compte rendu de réunion", "Tableau de bord hebdo"],
  };
  for (const [department, agents] of Object.entries(expected)) {
    const region = page.getByRole("region", { name: department });
    for (const agent of agents) await expect(region.getByRole("link", { name: new RegExp(agent) })).toBeVisible();
  }
  // The two video agents arrived with the render worker (Step 8, e2e/video.spec.ts).
  await expect(page.getByRole("region", { name: "Marketing" }).getByRole("link", { name: /Motion design/ })).toBeVisible();
  await shot(page, "80-library-agents");
});

test("Proposal Writer: a form, a draft, and Word and PDF exports", async () => {
  await openAgent("Proposition commerciale");
  await page.getByRole("combobox", { name: "Client" }).click();
  await page.getByRole("option", { name: "Client A" }).click();
  await page.getByLabel("Besoins du client *").fill("Refonte du site avec commande en ligne, mise en ligne avant décembre.");
  await page.getByLabel("Budget ou éléments de prix").fill("8 000 à 10 000 € HT");
  await shot(page, "81-proposal-form");
  await page.getByRole("button", { name: "Lancer" }).click();
  const answer = await waitForAnswer();
  await expect(answer).toContainText("Tool instructions received: Proposal Writer");
  await expect(answer).toContainText("Besoins du client");

  await answer.getByRole("button", { name: "Exporter" }).click();
  await expect(page.getByRole("menuitem", { name: "Document Word (.docx)" })).toBeVisible();
  // No table in this answer: no spreadsheet export offered.
  await expect(page.getByRole("menuitem", { name: "Tableau Excel (.xlsx)" })).toHaveCount(0);
  await shot(page, "82-export-menu");
  await page.keyboard.press("Escape");

  const docx = await download(answer, "Document Word (.docx)");
  expect(docx.name).toMatch(/\.docx$/);
  expect(docx.bytes.subarray(0, 2).toString()).toBe("PK");
  const pdf = await download(answer, "PDF");
  expect(pdf.name).toMatch(/\.pdf$/);
  expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
});

test("Invoice Intake: files in the form, a table, Excel and CSV exports, the draft notice", async () => {
  await openAgent("Saisie de factures");
  await expect(page.getByText("Brouillon à vérifier par une personne")).toBeVisible();
  await page.getByLabel("Factures (PDF ou images) *").setInputFiles([
    { name: "facture-ovh.txt", mimeType: "text/plain", buffer: Buffer.from("OVH SAS — Facture FR58213947 du 02/09/2026 — Total HT 89,99 € — TVA 18,00 € — TTC 107,99 €") },
    { name: "facture-bureau.txt", mimeType: "text/plain", buffer: Buffer.from("Bureau Vallée — Facture 2026-1442 du 11/09/2026 — HT 177,50 € — TVA 35,50 € — TTC 213,00 €") },
  ]);
  await expect(page.getByText("facture-bureau.txt")).toBeVisible();
  await shot(page, "83-invoice-form");
  await page.getByRole("button", { name: "Lancer" }).click();
  const answer = await waitForAnswer();
  await expect(answer).toContainText("Tool instructions received: Invoice Intake");
  await expect(answer.locator("table")).toBeVisible();
  // The files went with the first message, read and protected on our servers.
  await expect(page.getByRole("link", { name: "facture-ovh.txt" })).toBeVisible();
  await expect(page.getByText("Brouillon à vérifier par une personne")).toBeVisible();

  const xlsx = await download(answer, "Tableau Excel (.xlsx)");
  expect(xlsx.name).toMatch(/\.xlsx$/);
  expect(xlsx.bytes.subarray(0, 2).toString()).toBe("PK");
  const csv = await download(answer, "Tableau CSV");
  expect(csv.name).toMatch(/\.csv$/);
  // French Excel: semicolons, decimal commas kept as they are, UTF-8 with a BOM.
  expect(csv.bytes.toString("utf8")).toContain("[TEST] January;18 500;15 200,50;12 300");
  expect(csv.bytes.subarray(0, 3).toString("hex")).toBe("efbbbf");
  await shot(page, "84-invoice-table");
});

test("Cash-flow Forecast: a chart with values on hover and its data as a table", async () => {
  await openAgent("Prévision de trésorerie");
  await page.getByLabel("Relevés bancaires (CSV, Excel, PDF) *").setInputFiles({
    name: "releve.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date;Libellé;Montant\n2026-09-01;LOYER;-2100\n2026-09-05;VIR CLIENT;9000\n2026-09-28;SALAIRES;-11500\n"),
  });
  await page.getByLabel("Solde actuel").fill("18 400 €");
  await page.getByRole("combobox", { name: "Horizon" }).click();
  await page.getByRole("option", { name: "6 mois" }).click();
  await page.getByRole("button", { name: "Lancer" }).click();
  const answer = await waitForAnswer();
  const chart = answer.getByRole("img", { name: /Graphique : \[TEST\] Balance/ });
  await expect(chart).toBeVisible();
  await expect(answer.getByText("Inflows", { exact: true }).first()).toBeVisible();
  const box = (await chart.boundingBox())!;
  await chart.hover({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(answer.getByRole("status")).toContainText("Feb");
  await shot(page, "85-cash-flow-chart");
  await answer.getByRole("button", { name: "Voir les données" }).click();
  await expect(answer.locator("figure table")).toContainText("21 000 €");
  await answer.getByRole("button", { name: "Masquer les données" }).click();
});

test("Application Review: the notice says a person decides", async () => {
  await openAgent("Aide à la lecture de candidatures");
  await expect(page.getByText("Il ne note, ne classe et n'écarte aucun candidat : une personne décide.")).toBeVisible();
  await shot(page, "86-application-review");
  await openAgent("Relecture de contrat");
  await expect(page.getByText("Ceci n'est pas un conseil juridique.")).toBeVisible();
});

test("the Owner adapts an agent, and disables another", async () => {
  await page.goto("/admin/agents");
  await page.getByRole("button", { name: "Adapter Proposition commerciale" }).click();
  const dialog = page.getByRole("dialog", { name: "Adapter « Proposition commerciale »" });
  await dialog.getByLabel("Consignes de l'entreprise").fill("Toujours proposer un acompte de 30 % et une option de maintenance.");
  await dialog.getByLabel("Ton").fill("Chaleureux et direct, vouvoiement.");
  await shot(page, "87-adapt-agent");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Adaptations enregistrées.")).toBeVisible();
  await expect(page.getByText(/Proposition commerciale.*adapté/).first()).toBeVisible();

  await page.getByRole("switch", { name: "Activer Relecture de contrat" }).click();
  await expect(page.getByText("Agent désactivé.")).toBeVisible();
  await page.goto("/library");
  await expect(page.getByRole("link", { name: /Relecture de contrat/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Modèles juridiques/ })).toBeVisible();

  await page.goto("/admin/agents");
  await page.getByRole("switch", { name: "Activer Relecture de contrat" }).click();
  await expect(page.getByText("Agent activé.")).toBeVisible();
  await shot(page, "88-admin-agents");
});
