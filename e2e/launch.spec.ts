import { execFileSync } from "node:child_process";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";
import { shot, signIn, skipAvatarStep, openSetup } from "./helpers";

/**
 * The launch success scenario of CLAUDE.md §10, steps 1 to 15, in one run with five people in five
 * browsers: our team, the Owner, Olivier, Nathalie (finance) and Marc (a member without access to
 * Client A). The server runs with AI_FAKE_PROVIDER=true (answers labelled "[TEST]") and the render
 * worker must be running for the MP4 of step 12.
 */
const run = Date.now().toString(36);
const company = `Atelier Lancement ${run}`;
const plan = `Lancement ${run}`;
const owner = `launch-owner-${run}@demo.local`;
const olivier = `launch-olivier-${run}@demo.local`;
const nathalie = `launch-nathalie-${run}@demo.local`;
const marc = `launch-marc-${run}@demo.local`;
const IBAN = "FR76 3000 6000 0112 3456 7890 189";
const CONTRACT =
  "Contrat cadre Client A. Durée : 24 mois à compter du 1er janvier 2026. Remise annuelle : une remise de 12 % est accordée sur le volume commandé. Paiement à 45 jours fin de mois.";

test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
let platformPage: Page, ownerPage: Page, olivierPage: Page, nathaliePage: Page, marcPage: Page;
let mainConversationUrl: string, clientSpaceUrl: string, documentUrl: string;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const open = async () => {
    const context = await browser.newContext({ locale: "fr-FR", acceptDownloads: true });
    contexts.push(context);
    return context.newPage();
  };
  [platformPage, ownerPage, olivierPage, nathaliePage, marcPage] = [await open(), await open(), await open(), await open(), await open()];
});
test.afterAll(async () => Promise.all(contexts.map((c) => c.close())));

const answers = (p: Page) => p.locator("article");
const userMessages = (p: Page) => p.locator(".group\\/user");
const soloComposer = (p: Page) => p.getByRole("textbox", { name: "Écrivez votre message…" });
const groupComposer = (p: Page) => p.getByRole("textbox", { name: "Écrivez à l'équipe… @IA pour faire répondre l'IA" });

async function waitForAnswers(p: Page, count: number, timeout = 30_000) {
  await expect(answers(p)).toHaveCount(count, { timeout });
  await expect(p.locator('article[aria-busy="true"]')).toHaveCount(0, { timeout });
}

async function send(p: Page, text: string) {
  const before = await answers(p).count();
  await soloComposer(p).fill(text);
  await p.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswers(p, before + 1);
  return answers(p).last();
}

async function chooseModel(p: Page, name: RegExp) {
  await p.getByRole("button", { name: "Choisir le modèle" }).click();
  await p.getByRole("menuitem", { name }).click();
}

async function join(p: Page, email: string, name: string, expertise?: string) {
  await p.goto(await latestLinkFor(email, new Date(0)));
  await p.getByRole("button", { name: "Accepter l'invitation" }).click();
  await p.getByLabel("Votre nom").fill(name);
  if (expertise) await p.getByLabel("Domaines d'expertise").fill(expertise);
  await p.getByRole("button", { name: "Continuer" }).click();
  // Straight into the first conversation (CLAUDE.md §11).
  await expect(p.getByRole("heading", { name: "Que puis-je faire pour vous ?" })).toBeVisible();
}

test("1. our team creates a plan; the Owner signs up, completes onboarding and gets the plan", async () => {
  await signIn(platformPage, "platform@demo.local");
  await platformPage.goto("/platform/plans");
  await platformPage.getByRole("button", { name: "Nouvelle offre" }).click();
  await platformPage.getByLabel("Nom").fill(plan);
  await platformPage.getByLabel("Prix mensuel par place").fill("35");
  await platformPage.getByLabel("Places").fill("10");
  await platformPage.getByLabel("Crédits / mois").fill("100000");
  await platformPage.getByLabel("Crédits vidéo").fill("2000");
  await platformPage.getByRole("button", { name: "Enregistrer" }).click();
  await expect(platformPage.getByText("Offre enregistrée")).toBeVisible();

  // Steps 1 to 3 of onboarding: company, profile, invitations (step 2 of the scenario), restricted Client A.
  await signIn(ownerPage, owner);
  await ownerPage.getByLabel("Votre nom").fill("Claire Martin");
  await ownerPage.getByLabel("Nom de l'entreprise").fill(company);
  await ownerPage.getByRole("button", { name: "Créer l'espace" }).click();
  await skipAvatarStep(ownerPage);
  await expect(ownerPage.getByRole("heading", { name: "Présentez votre entreprise" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await openSetup(ownerPage, "invite");
  await expect(ownerPage.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
  await ownerPage.getByLabel("Adresses e-mail").fill(`${olivier}, ${nathalie}, ${marc}`);
  await ownerPage.getByRole("button", { name: "Envoyer les invitations" }).click();
  await expect(ownerPage.getByText("E-mail envoyé")).toHaveCount(3);
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await openSetup(ownerPage, "client");
  await expect(ownerPage.getByRole("heading", { name: "Ajoutez un premier client" })).toBeVisible();
  await ownerPage.getByLabel("Nom du client").fill("Client A");
  await ownerPage.getByRole("button", { name: /Restreint/ }).click();
  await ownerPage.getByRole("button", { name: "Créer le client" }).click();
  await openSetup(ownerPage, "document");
  await expect(ownerPage.getByRole("heading", { name: "Votre premier document" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Continuer" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Bonjour Claire" })).toBeVisible();

  await platformPage.goto("/platform/companies");
  const row = platformPage.getByRole("row").filter({ hasText: company });
  await row.getByRole("combobox").first().click();
  await platformPage.getByRole("option", { name: plan }).click();
  await expect(platformPage.getByText("Modification enregistrée")).toBeVisible();
  await expect(platformPage.getByRole("row").filter({ hasText: company })).toContainText(plan);
  await shot(platformPage, "L01-plan-assigned");
});

test("2–3. Olivier and Nathalie (finance) join; Client A is restricted to Olivier, Client B is open", async () => {
  await join(olivierPage, olivier, "Olivier Martin");
  await join(nathaliePage, nathalie, "Nathalie Durand", "finance, trésorerie");
  await join(marcPage, marc, "Marc Petit");

  await ownerPage.goto("/admin/clients");
  await ownerPage.getByRole("button", { name: /Personne n'a accès/ }).click();
  await ownerPage.getByRole("checkbox").first().waitFor();
  await ownerPage.getByText("Olivier Martin").click();
  await expect(ownerPage.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await ownerPage.getByRole("button", { name: "Terminé" }).click();

  await ownerPage.getByRole("button", { name: "Nouveau client" }).click();
  await ownerPage.getByLabel("Nom du client").fill("Client B");
  await ownerPage.getByRole("button", { name: "Créer le client" }).click();
  await expect(ownerPage.getByText("Client B").first()).toBeVisible();
  await shot(ownerPage, "L02-clients");

  // Marc sees the open client only.
  await marcPage.goto("/clients");
  await expect(marcPage.getByRole("main").getByRole("link", { name: /Client B/ })).toBeVisible();
  await expect(marcPage.getByRole("main").getByRole("link", { name: /Client A/ })).toHaveCount(0);
});

test("4. the Owner adds a Client A document and saves a Client A memory entry", async () => {
  await ownerPage.goto("/memory");
  await ownerPage.getByRole("main").getByRole("link", { name: /Client A/ }).click();
  await expect(ownerPage).toHaveURL(/\/memory\/[0-9a-f-]{36}$/);
  clientSpaceUrl = ownerPage.url();
  await ownerPage.getByRole("tab", { name: /Documents/ }).click();
  await ownerPage.getByTestId("memory-document-input").first().setInputFiles({ name: "contrat-client-a.txt", mimeType: "text/plain", buffer: Buffer.from(CONTRACT) });
  await expect(ownerPage.getByText(/Prêt · 1 passage/)).toBeVisible({ timeout: 30_000 });

  await ownerPage.getByRole("tab", { name: /Entrées/ }).click();
  await ownerPage.getByRole("button", { name: "Nouvelle entrée" }).first().click();
  const dialog = ownerPage.getByRole("dialog");
  await dialog.getByLabel("Titre").fill("Budget Client A");
  await dialog.getByLabel("Contenu").fill("Le budget annuel du Client A est de 80 000 euros.");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(ownerPage.getByText("Entrée enregistrée en mémoire.")).toBeVisible();
  await shot(ownerPage, "L04-client-memory");
});

test("5. Olivier asks ChatGPT about Client A: the answer shows Source Proof", async () => {
  await olivierPage.goto("/chat");
  await chooseModel(olivierPage, /GPT-6 Luna/);
  const answer = await send(olivierPage, "Quelle remise annuelle prévoit le contrat de Client A ?");
  await expect(answer).toContainText("Simulated answer from gpt-6-luna");
  await expect(answer).toContainText("Knowledge passages received");
  const sources = answer.getByRole("region", { name: "Sources" });
  await expect(sources).toContainText("contrat-client-a.txt");
  await expect(sources).toContainText("Mémoire · Client A");
  mainConversationUrl = olivierPage.url();

  await sources.getByRole("button", { name: /contrat-client-a\.txt/ }).click();
  const sheet = olivierPage.getByRole("dialog", { name: "Passage cité" });
  await expect(sheet).toContainText("remise de 12 %");
  await sheet.getByRole("link", { name: "Ouvrir le document à ce passage" }).click();
  await expect(olivierPage.getByRole("heading", { name: "contrat-client-a.txt" })).toBeVisible();
  documentUrl = olivierPage.url().split("?")[0];
  await olivierPage.goBack();
  await expect(olivierPage).toHaveURL(mainConversationUrl);
  await shot(olivierPage, "L05-source-proof");
});

test("6. Olivier continues with Claude: the whole conversation goes with him", async () => {
  await chooseModel(olivierPage, /Sonnet 5\.5/);
  const answer = await send(olivierPage, "Fais-en un résumé en une phrase.");
  await expect(answer).toContainText("Simulated answer from claude-sonnet-5-5");
  await expect(answer).toContainText("Messages received: 3 (2 from people)");
  // The answer's own header names the model (no banner).
  await expect(answer.locator("header")).toContainText("Sonnet");
});

test("7. Hide on Automatic: an IBAN and a client name reach the model as placeholders, Olivier sees the real values", async () => {
  await expect(olivierPage.getByRole("switch", { name: "Masquage auto" })).toBeChecked();
  await soloComposer(olivierPage).fill(`Prépare le virement de l'acompte sur ${IBAN} pour Client A.`);
  await expect(olivierPage.locator("[data-hide]", { hasText: "FR76" }).first()).toHaveAttribute("data-hide", "protected");
  await expect(olivierPage.locator("[data-hide]", { hasText: "Client A" }).first()).toHaveAttribute("data-hide", "protected");
  await olivierPage.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswers(olivierPage, 3);

  const message = userMessages(olivierPage).last();
  await message.getByRole("button", { name: "Voir ce que l'IA a reçu" }).click();
  await expect(message).toContainText("Prépare le virement de l'acompte sur [IBAN_1] pour [CLIENT_1].");
  const answer = answers(olivierPage).last();
  await expect(answer).toContainText(`Last message as received: «Prépare le virement de l'acompte sur ${IBAN} pour Client A.»`);
  await answer.getByRole("button", { name: "Voir la réponse telle que l'IA l'a écrite" }).click();
  // Next to the restored answer, the model's own text: only placeholders.
  await expect(answer).toContainText("«Prépare le virement de l'acompte sur [IBAN_1] pour [CLIENT_1].»");
  await shot(olivierPage, "L07-hide");
});

test("8. a finance question: the AI suggests asking Nathalie", async () => {
  const answer = await send(olivierPage, "J'ai besoin d'aide sur la trésorerie de ce dossier.");
  await expect(answer).toContainText("You can ask Nathalie Durand about it.");
  await expect(olivierPage.getByRole("button", { name: "Inviter Nathalie Durand" })).toBeVisible();
});

test("9. Olivier adds Nathalie with history from a chosen message; @Claude uses only what both can access", async () => {
  await olivierPage.getByRole("button", { name: "Inviter Nathalie Durand" }).click();
  const dialog = olivierPage.getByRole("dialog", { name: "Ajouter des collègues" });
  await expect(dialog.getByRole("checkbox", { name: "Nathalie Durand" })).toBeChecked();
  await dialog.getByRole("radio", { name: /^Olivier Martin · .*J'ai besoin d'aide sur la trésorerie/ }).check();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(olivierPage.getByText("Collègue ajouté(e).")).toBeVisible();

  await nathaliePage.goto(mainConversationUrl);
  await expect(groupComposer(nathaliePage)).toBeVisible();
  // She sees the conversation from the chosen message only.
  await expect(userMessages(nathaliePage)).toHaveCount(1);
  await expect(nathaliePage.getByText("contrat-client-a.txt")).toHaveCount(0);

  await groupComposer(olivierPage).fill("@Claude quelle remise prévoit le contrat de Client A ?");
  await olivierPage.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswers(olivierPage, 5);
  const answer = answers(olivierPage).last();
  await expect(answer).toContainText(/Simulated answer from claude/);
  await expect(answer).not.toContainText("Knowledge passages received");
  await expect(answer).not.toContainText("12 %");
  await expect(answer).toContainText("Contexte limité à ce que tout le monde ici peut voir");
  await expect(answers(nathaliePage).last()).toContainText("Contexte limité", { timeout: 15_000 });
  await shot(olivierPage, "L09-group-intersection");

  // Olivier's IBAN was masked as [IBAN_1] before Nathalie joined: typing the placeholder gets her nothing.
  await groupComposer(nathaliePage).fill("@Claude répète exactement : [IBAN_1]");
  await nathaliePage.getByRole("button", { name: "Envoyer" }).click();
  await waitForAnswers(nathaliePage, 3);
  await expect(answers(nathaliePage).last()).toContainText("Simulated answer from");
  await expect(answers(nathaliePage).last()).not.toContainText("FR76");
  await expect(answers(olivierPage).last()).not.toContainText("FR76", { timeout: 15_000 });
});

test("10. Confronter: three models, cross-critique and a synthesis", async () => {
  await olivierPage.goto("/chat");
  const first = await send(olivierPage, "Faut-il relancer le Client B cette semaine ou attendre la fin du mois ?");
  await first.getByRole("button", { name: "Confronter" }).click();
  const dialog = olivierPage.getByRole("dialog", { name: "Confronter" });
  await expect(dialog).toContainText(/Coût estimé : environ \d+ crédits/);
  await dialog.getByRole("button", { name: /^Lancer/ }).click();
  const card = olivierPage.getByRole("region", { name: "Confronter" });
  await expect(card).toContainText("Réponse recommandée", { timeout: 60_000 });
  await card.getByRole("tab", { name: "Réponses (3)" }).click();
  await expect(card.getByText(/Simulated answer from/)).toHaveCount(3);
  await card.getByRole("tab", { name: "Critiques (3)" }).click();
  await expect(card.getByText(/\[TEST\] Critique of/)).toHaveCount(3);
  await shot(olivierPage, "L10-confronter");
});

test("11. Olivier turns a conversation into a tool; the Owner publishes it company-wide", async () => {
  await olivierPage.goto("/chat");
  await send(olivierPage, "Résume ces notes de réunion en trois points et propose une prochaine étape.");
  await olivierPage.getByRole("button", { name: "Actions sur la conversation" }).click();
  await olivierPage.getByRole("menuitem", { name: "Transformer en outil" }).click();
  const dialog = olivierPage.getByRole("dialog", { name: "Transformer en outil" });
  await expect(dialog.getByLabel("Nom")).toHaveValue("[TEST] Synthèse client", { timeout: 30_000 });
  await dialog.getByRole("radio", { name: /Toute l'entreprise/ }).check();
  await dialog.getByRole("button", { name: "Enregistrer et demander la validation" }).click();
  await expect(olivierPage.getByText("En attente de validation")).toBeVisible();

  await ownerPage.goto("/admin/agents");
  await expect(ownerPage.getByRole("heading", { name: "À valider (1)" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Valider" }).click();
  await expect(ownerPage.getByText("Outil validé pour toute l'entreprise.")).toBeVisible();
  // Published: Marc, a plain member, finds it in his library.
  await marcPage.goto("/apps");
  await expect(marcPage.getByRole("link", { name: /\[TEST\] Synthèse client/ })).toBeVisible();
});

test("12. Olivier runs the Proposal Writer, then Motion Design: an MP4 is rendered", async () => {
  test.setTimeout(300_000);
  await olivierPage.goto("/apps");
  await olivierPage.getByRole("link", { name: /Proposition commerciale/ }).first().click();
  await olivierPage.getByRole("combobox", { name: "Client" }).click();
  await olivierPage.getByRole("option", { name: "Client A" }).click();
  await olivierPage.getByLabel("Besoins du client *").fill("Refonte du site avec commande en ligne, mise en ligne avant décembre.");
  await olivierPage.getByRole("button", { name: "Lancer", exact: true }).click();
  await expect(olivierPage).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await waitForAnswers(olivierPage, 1);
  await expect(answers(olivierPage).last()).toContainText("Tool instructions received: Proposal Writer");

  await olivierPage.goto("/apps");
  await olivierPage.getByRole("link", { name: /Motion design/ }).first().click();
  await olivierPage.getByLabel("Brief (message, textes, public) *").fill("Annonce de la nouvelle offre de maintenance, pour nos clients.");
  const logo = test.info().outputPath("logo.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x2a78d6:size=256x256", "-frames:v", "1", logo]);
  await olivierPage.getByLabel("Logo et images (PNG, JPG)").setInputFiles(logo);
  await olivierPage.getByRole("combobox", { name: "Format" }).click();
  await olivierPage.getByRole("option", { name: "9:16 · vertical" }).click();
  await olivierPage.getByRole("combobox", { name: "Durée" }).click();
  await olivierPage.getByRole("option", { name: "6 secondes" }).click();
  await olivierPage.getByRole("button", { name: "Lancer", exact: true }).click();
  await expect(olivierPage).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await waitForAnswers(olivierPage, 1);
  const answer = answers(olivierPage).last();
  await expect(answer.getByText("Préparation de l'aperçu…")).toHaveCount(0, { timeout: 30_000 });
  await answer.getByRole("button", { name: "Fabriquer la vidéo" }).click();
  const job = answer.getByTestId("render-job").first();
  await expect(job).toHaveAttribute("data-status", "succeeded", { timeout: 200_000 });
  await expect(job.locator("video")).toHaveCount(1);
  await shot(olivierPage, "L12-motion-mp4");
});

test("13. Olivier transfers Client A to Nathalie with a Smart Handover and loses access", async () => {
  await olivierPage.goto("/clients");
  await olivierPage.getByRole("link", { name: /^Client A Restreint/ }).click();
  await expect(olivierPage).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = olivierPage.url();
  await olivierPage.getByRole("button", { name: "Transférer ce client" }).click();
  const dialog = olivierPage.getByRole("dialog", { name: "Transférer le client Client A" });
  await dialog.getByRole("radio", { name: /Nathalie Durand/ }).check();
  await dialog.getByRole("button", { name: "Transférer", exact: true }).click();
  await expect(olivierPage.getByText("Transféré à Nathalie Durand.")).toBeVisible({ timeout: 30_000 });
  // Client B is open to everyone: only Client A is gone.
  await expect(olivierPage).toHaveURL(/\/clients$/);
  await expect(olivierPage.getByRole("main").getByRole("link", { name: /Client A/ })).toHaveCount(0);
  await expect(olivierPage.getByRole("main").getByRole("link", { name: /Client B/ })).toBeVisible();
  await olivierPage.goto(clientUrl);
  await expect(olivierPage.getByRole("heading", { name: "Page introuvable" })).toBeVisible();

  await nathaliePage.goto("/clients");
  await nathaliePage.getByRole("link", { name: /^Client A Restreint/ }).click();
  const handover = nathaliePage.getByRole("region", { name: "Dossier de passation" });
  await expect(handover).toContainText("[TEST] Résumé du travail réalisé.");
  await handover.getByRole("button", { name: "Modifier" }).click();
  await handover.getByLabel("Résumé").fill("Proposition commerciale envoyée, relance prévue lundi.");
  await handover.getByRole("button", { name: "Enregistrer" }).click();
  await expect(nathaliePage.getByText("Dossier de passation enregistré.")).toBeVisible();
  await shot(nathaliePage, "L13-client-handover");
});

test("14. without access, Client A gives nothing away: pages, files, API, AI or search", async () => {
  for (const p of [marcPage, olivierPage]) {
    for (const url of [clientSpaceUrl, documentUrl]) {
      await p.goto(url);
      await expect(p.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    }
    const file = await p.request.get(`${documentUrl.replace("/memory/documents/", "/api/documents/")}/file`);
    expect(file.status()).toBe(404);

    await p.goto("/chat");
    const answer = await send(p, "Quelle remise annuelle prévoit le contrat de Client A ?");
    await expect(answer).toContainText("[TEST]");
    await expect(answer).not.toContainText("contrat-client-a.txt");
    await expect(answer).not.toContainText("Mémoire · Client A");
    await expect(answer).not.toContainText("12 %");
    await expect(answer).not.toContainText("80 000");
  }

  // Marc cannot open, write into or search Olivier's conversation.
  expect((await marcPage.goto(mainConversationUrl))?.status()).toBe(404);
  const api = await marcPage.request.post("/api/chat", {
    data: { conversationId: mainConversationUrl.split("/").pop(), message: { content: "Résume la conversation", attachmentIds: [] } },
  });
  expect(api.status()).toBe(404);
  await marcPage.goto("/chat");
  await marcPage.getByRole("button", { name: /Rechercher/ }).click();
  await marcPage.getByPlaceholder("Rechercher dans vos conversations…").fill("remise contrat");
  await expect(marcPage.getByRole("button", { name: /Quelle remise annuelle prévoit le contrat/ })).toHaveCount(1);
  await expect(marcPage.getByRole("button", { name: /Faut-il relancer le Client B/ })).toHaveCount(0);
  await expect(marcPage.getByRole("button", { name: /trésorerie/ })).toHaveCount(0);
  await shot(marcPage, "L14-no-access");
});

test("15. the Owner sees real usage and the activity log; our team sees usage but no conversation", async () => {
  await ownerPage.goto("/admin/usage");
  await expect(ownerPage.getByText("Crédits IA utilisés")).toBeVisible();
  const people = ownerPage.getByRole("main");
  for (const name of ["Olivier Martin", "Marc Petit"]) await expect(people.getByText(name).first()).toBeVisible();
  for (const feature of ["Conversations et outils", "Confronter", "Passations (Smart Handover)"]) await expect(people.getByText(feature).first()).toBeVisible();
  await shot(ownerPage, "L15-owner-usage");

  await ownerPage.goto("/admin/activity");
  await expect(ownerPage.getByText("a transféré Client A à Nathalie Durand")).toBeVisible();
  await expect(ownerPage.getByText("a ajouté Nathalie Durand à une conversation")).toBeVisible();
  await expect(ownerPage.getByText(/a lancé la fabrication d'une vidéo/)).toBeVisible();
  await shot(ownerPage, "L15-owner-activity");

  await platformPage.goto("/platform/usage");
  const row = platformPage.getByRole("row").filter({ hasText: company });
  await expect(row).toContainText(plan);
  // Revenue: 4 active seats × 35 €.
  await expect(row).toContainText(/140\s€/);
  await row.getByRole("link", { name: company }).click();
  await expect(platformPage.getByText(/Totaux uniquement/)).toBeVisible();
  for (const name of ["Olivier Martin", "Nathalie Durand", "Claire Martin"]) {
    await expect(platformPage.getByRole("main").getByText(name)).toHaveCount(0);
  }
  await shot(platformPage, "L15-platform-company");
  // A conversation's address is "not found" for our team, never its content.
  expect((await platformPage.goto(mainConversationUrl))?.status()).toBe(404);
  await expect(platformPage.getByText("Quelle remise annuelle")).toHaveCount(0);
});
