import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fr from "../../messages/fr.json";
import en from "../../messages/en.json";
import { BUILTIN_AGENTS, builtinAgent } from "@/modules/agents/builtins";
import { composeRunMessage, outputFormatInstruction } from "@/modules/agents/definitions";
import { parseChartSpec } from "@/modules/conversations/chart-spec";
import { buildSystemPrompt } from "@/modules/conversations/system-prompt";
import { hasTable, markdownToBlocks, tablesOf } from "@/modules/exports/blocks";
import { getProvider } from "@/modules/providers/server/registry";
import type { KnowledgePassage } from "@/modules/memory/types";

/**
 * The 14 launch agents against a real model (`pnpm test:smoke`), each with a realistic French and English
 * example (BUILD_STEPS Step 7). Same system prompt and form message as in the app; attached files are given
 * as their extracted text, the way the chat sends them. Answers are saved in test-results/agent-runs/ to
 * be read by a person. Skipped without an OpenAI key.
 */

const MODEL = process.env.SMOKE_AGENT_MODEL ?? "gpt-6-luna";
const OUT = join(process.cwd(), "test-results", "agent-runs");

type Example = {
  values: Record<string, string>;
  client?: { name: string; sector?: string; description?: string };
  files?: { name: string; text: string }[];
  knowledge?: string;
};
type Lang = "fr" | "en";
type Launch = Record<string, { name: string; fields?: Record<string, string>; options?: Record<string, Record<string, string>> }>;

const EXAMPLES: Record<string, Record<Lang, Example>> = {
  proposal_writer: {
    fr: {
      client: { name: "Boulangerie Marchand", sector: "Boulangerie-pâtisserie, 3 boutiques à Lyon" },
      values: {
        client: "c",
        needs: "Refonte du site vitrine avec commande en ligne de gâteaux (retrait en boutique). Ils veulent modifier eux-mêmes les produits et les prix, et recevoir les commandes par e-mail.",
        offer: "Site Webflow 6 pages, module click & collect, formation de 2 h, maintenance 12 mois",
        budget: "Entre 8 000 et 10 000 € HT",
        deadline: "Mise en ligne avant le 1er décembre",
      },
    },
    en: {
      client: { name: "Harbor Dental Clinic", sector: "Dental clinic, 2 sites in Bristol" },
      values: {
        client: "c",
        needs: "New patient onboarding: online booking, digital intake forms, SMS reminders to reduce no-shows (currently about 12%).",
        offer: "Set-up of booking software, forms configuration, half-day staff training, 3 months of support",
        budget: "£6,500 one-off + £180/month",
        deadline: "Live by mid-January",
      },
    },
  },
  meeting_prep: {
    fr: {
      client: { name: "Groupe Vernet", sector: "BTP" },
      knowledge:
        "Contrat de maintenance 2025 : 24 000 € HT par an. Deux incidents majeurs en mars 2025. Délai d'intervention moyen constaté : 6 h, pour un engagement contractuel de 4 h. Claire Vernet (DAF) a demandé une remise de 15 % en septembre.",
      values: { client: "c", goal: "Renouveler le contrat de maintenance annuel : ils trouvent le prix trop élevé.", date: "Jeudi 14 h, en visio", attendees: "Claire Vernet (DAF), moi" },
    },
    en: {
      client: { name: "Northwind Logistics", sector: "Freight and warehousing" },
      knowledge:
        "Northwind uses our reporting dashboard since 2024 (25 users). In the last QBR they complained that they rebuild delivery-delay reports by hand in Excel every Monday. Their operations director, Sam Patel, owns the budget.",
      values: { client: "c", goal: "Present the analytics module and agree on a 30-day pilot.", date: "Tuesday 10am, at their office", attendees: "Sam Patel (Ops director), their IT lead, me" },
    },
  },
  invoice_intake: {
    fr: {
      values: { invoices: "3 fichier(s) joint(s)", instructions: "Catégories : Logiciels, Fournitures, Déplacements, Sous-traitance" },
      files: [
        { name: "facture-ovh-2026-09.pdf", text: "OVH SAS\nFacture n° FR58213947\nDate : 02/09/2026 — Échéance : 02/09/2026\nHébergement VPS Pro (septembre 2026)\nTotal HT : 89,99 €\nTVA 20 % : 18,00 €\nTotal TTC : 107,99 €" },
        { name: "bureau-vallee-1442.pdf", text: "Bureau Vallée Lyon 7\nFacture 2026-1442 du 11 septembre 2026, payable à 30 jours\nRamettes papier A4 x10 — 45,00 € HT\nCartouches toner — 132,50 € HT\nTotal HT 177,50 € — TVA 20 % 35,50 € — Net à payer 213,00 €" },
        { name: "sncf-billet.pdf", text: "SNCF Voyageurs — Justificatif de voyage\nN° de dossier QZT8KP — émis le 15/09/2026\nLyon Part-Dieu → Paris Gare de Lyon, aller-retour, 2e classe\nMontant TTC : 142,00 € dont TVA 10 % : 12,91 €" },
      ],
    },
    en: {
      values: { invoices: "3 attached file(s)", instructions: "Categories: Software, Office supplies, Travel, Contractors" },
      files: [
        { name: "aws-invoice-sept.pdf", text: "Amazon Web Services EMEA SARL\nInvoice Number: EUINGB26-0912345\nInvoice Date: September 3, 2026\nTotal pre-tax: USD 412.37\nVAT (20%): USD 82.47\nTotal: USD 494.84\nDue upon receipt" },
        { name: "staples-88213.pdf", text: "Staples UK\nInvoice 88213 — 9 Sep 2026 — Payment terms: 30 days\nPrinter paper A4 x 5 boxes £38.00\nDesk organisers x 4 £24.00\nSubtotal £62.00  VAT 20% £12.40  Total £74.40" },
        { name: "freelance-design-007.pdf", text: "Maya Chen Design Ltd — Invoice #007\nDate: 18/09/2026, due 18/10/2026\nBrand refresh — logo variations and social templates: £1,800.00\nVAT not applicable (below VAT threshold)\nTotal due: £1,800.00" },
      ],
    },
  },
  payment_reminders: {
    fr: {
      values: {
        invoices: "Atelier Dumas — F-2026-071 — 2 400 € TTC — échéance 15/08/2026\nCabinet Leroy — F-2026-079 — 860 € TTC — échéance 31/08/2026",
        stage: "second",
        signature: "Julie Martin, comptabilité",
      },
    },
    en: {
      values: { invoices: "Greenleaf Cafés — INV-1043 — £3,150 — due 2026-08-20\nBright Path Tutors — INV-1051 — £640 — due 2026-09-01", stage: "final", signature: "Tom Reed, Accounts" },
    },
  },
  cash_flow_forecast: {
    fr: {
      values: { exports: "1 fichier joint", opening: "18 400 €", recurring: "Loyer 2 100 €/mois, salaires 11 500 €/mois, client Vernet 9 000 €/mois, abonnements logiciels 450 €/mois", horizon: "6" },
      files: [
        {
          name: "releve-banque-T3.csv",
          text: "Date;Libellé;Montant\n2026-07-01;LOYER BUREAUX;-2100\n2026-07-05;VIR GROUPE VERNET;9000\n2026-07-12;VIR CLIENT MARCHAND;4200\n2026-07-28;SALAIRES JUILLET;-11500\n2026-07-30;URSSAF;-3900\n2026-08-01;LOYER BUREAUX;-2100\n2026-08-05;VIR GROUPE VERNET;9000\n2026-08-28;SALAIRES AOUT;-11500\n2026-09-01;LOYER BUREAUX;-2100\n2026-09-05;VIR GROUPE VERNET;9000\n2026-09-14;VIR CLIENT LEROY;6800\n2026-09-28;SALAIRES SEPTEMBRE;-11500\n2026-09-30;URSSAF;-3900",
        },
      ],
    },
    en: {
      values: { exports: "1 attached file", opening: "£42,000", recurring: "Rent £3,200/month, payroll £21,000/month, retainer from Northwind £15,000/month, quarterly VAT payment about £6,000 (next in January)", horizon: "6" },
      files: [
        {
          name: "bank-export-q3.csv",
          text: "Date,Description,Amount\n2026-07-01,OFFICE RENT,-3200\n2026-07-03,NORTHWIND RETAINER,15000\n2026-07-15,PROJECT ATLAS MILESTONE,8000\n2026-07-27,PAYROLL,-21000\n2026-08-01,OFFICE RENT,-3200\n2026-08-03,NORTHWIND RETAINER,15000\n2026-08-27,PAYROLL,-21000\n2026-09-01,OFFICE RENT,-3200\n2026-09-03,NORTHWIND RETAINER,15000\n2026-09-20,SOFTWARE ANNUAL PLAN,-2400\n2026-09-27,PAYROLL,-21000",
        },
      ],
    },
  },
  margin_analysis: {
    fr: {
      values: {
        figures: "Produit;CA HT;Coûts directs\nSites vitrines;86 000;41 000\nBoutiques en ligne;124 000;79 000\nMaintenance;52 000;14 500\nFormations;18 000;11 200\nFrais généraux partagés : 38 000 € (à répartir au prorata du CA)",
        by: "product",
        period: "Janvier à septembre 2026",
      },
    },
    en: {
      values: {
        figures: "Client,Revenue,Direct costs\nNorthwind Logistics,135000,82000\nHarbor Dental,48000,21000\nGreenleaf Cafés,27000,24500\nAtlas Retail,61000,30500",
        by: "client",
        period: "FY 2026 to date",
      },
    },
  },
  job_posting_writer: {
    fr: {
      values: {
        role: "Chargé(e) de projet web",
        context: "Agence de 9 personnes à Lyon. Missions : suivre 6 à 8 projets clients en parallèle, rédiger les cahiers des charges, coordonner développeurs et graphistes. Profil : 2 ans d'expérience en gestion de projet digital, aisance avec Webflow ou WordPress.",
        contract: "permanent",
        location: "Lyon 7e, 2 jours de télétravail par semaine",
        salary: "36 000 – 42 000 € brut annuel",
      },
    },
    en: {
      values: {
        role: "Customer Success Manager",
        context: "B2B software company, 25 people. You will onboard new clients, run quarterly reviews and reduce churn. We need 3+ years in customer success or account management and confident spoken English.",
        contract: "permanent",
        location: "Manchester, hybrid (3 days in office)",
        salary: "£38,000 – £45,000",
      },
    },
  },
  application_review: {
    fr: {
      values: { role: "Assistant(e) comptable", criteria: "1. Maîtrise de la saisie comptable et des rapprochements bancaires\n2. Connaissance d'un logiciel comptable (Sage, Pennylane…)\n3. Disponible sous 1 mois", applications: "2 fichiers joints" },
      files: [
        { name: "cv-camille-roux.pdf", text: "Camille Roux — 29 ans\nAssistante comptable, Cabinet Fidal Conseil (2022–2026) : saisie des achats et ventes pour 40 dossiers, rapprochements bancaires mensuels, préparation des déclarations de TVA.\nLogiciels : Sage 100, Excel avancé.\nBTS Comptabilité et gestion (2019).\nPréavis : 1 mois." },
        { name: "cv-karim-benali.pdf", text: "Karim Benali\nGestionnaire administratif, PME industrielle (2020–2026) : facturation clients, relances, suivi des notes de frais.\nFormation : DCG en cours (UE comptabilité validée).\nOutils : Pennylane (utilisateur quotidien), Excel.\nDisponible immédiatement." },
      ],
    },
    en: {
      values: { role: "Junior marketing assistant", criteria: "1. Writes clear social media content\n2. Has used a design tool (Canva, Figma)\n3. Can work in our London office 3 days a week", applications: "2 attached files" },
      files: [
        { name: "cv-emma-hughes.pdf", text: "Emma Hughes\nMarketing intern, Brightside Studio (6 months, 2025): wrote Instagram and LinkedIn posts for 5 clients, grew one account from 2k to 6k followers.\nTools: Canva, Later, Google Analytics.\nBA Media Studies, University of Leeds.\nLives in East London." },
        { name: "cv-daniel-okafor.pdf", text: "Daniel Okafor\nRetail supervisor (2021–2026). Runs the shop's Facebook page and writes the monthly newsletter.\nShort course: Figma fundamentals (2025).\nLooking for a first role in marketing. Based in Reading, happy to commute." },
      ],
    },
  },
  contract_review: {
    fr: {
      values: { contract: "1 fichier joint", side: "client", focus: "Responsabilité, résiliation et reconduction" },
      files: [
        {
          name: "contrat-prestation-infogerance.pdf",
          text: "CONTRAT DE PRESTATION D'INFOGÉRANCE\nEntre NetServices SAS (le Prestataire) et Agence Lumen SARL (le Client).\nArticle 1 — Objet : maintenance du parc informatique (12 postes) et du serveur.\nArticle 2 — Durée : 36 mois à compter du 1er novembre 2026, renouvelable par tacite reconduction pour des périodes de 36 mois sauf dénonciation par lettre recommandée 6 mois avant l'échéance.\nArticle 3 — Prix : 1 450 € HT par mois, révisable chaque année à la seule discrétion du Prestataire.\nArticle 4 — Délai d'intervention : le Prestataire s'efforcera d'intervenir dans les meilleurs délais.\nArticle 5 — Responsabilité : la responsabilité du Prestataire est limitée à un mois de redevance. Le Prestataire n'est pas responsable des pertes de données.\nArticle 6 — Résiliation : le Client ne peut résilier qu'en cas de faute grave prouvée du Prestataire. En cas de résiliation anticipée, toutes les redevances restant dues jusqu'au terme sont exigibles.\nArticle 7 — Loi applicable : droit français, tribunal de commerce de Paris.",
        },
      ],
    },
    en: {
      values: { contract: "1 attached file", side: "supplier", focus: "Payment terms and intellectual property" },
      files: [
        {
          name: "master-services-agreement.pdf",
          text: "MASTER SERVICES AGREEMENT\nBetween Atlas Retail Ltd (Customer) and Pixel & Co Ltd (Supplier).\n1. Services: design and development of the Customer's e-commerce website as described in Statement of Work 1.\n2. Fees: £48,000, payable within 90 days of the Customer's written acceptance of the final deliverables.\n3. Acceptance: the Customer may reject any deliverable at its sole discretion, without stating reasons.\n4. Intellectual property: all rights in any material created by the Supplier, including pre-existing tools and code libraries, vest in the Customer upon creation.\n5. Liability: the Supplier's liability is unlimited. The Customer's liability is capped at £1,000.\n6. Termination: the Customer may terminate for convenience at any time with 7 days' notice; no fees are due for work not yet accepted.\n7. Non-solicitation: the Supplier shall not work for any other retailer for 24 months.",
        },
      ],
    },
  },
  template_drafter: {
    fr: {
      values: {
        type: "nda",
        details: "Accord de confidentialité réciproque entre Agence Lumen SARL (Lyon) et Groupe Vernet SA (Villeurbanne), dans le cadre de l'étude d'un projet de portail client.",
        specifics: "Durée de confidentialité de 3 ans, restitution ou destruction des documents à la fin des discussions.",
      },
    },
    en: {
      values: {
        type: "terms_of_sale",
        details: "Pixel & Co Ltd, a web design agency in Manchester selling website packages (Starter £2,900, Growth £6,500) to small businesses.",
        specifics: "50% deposit before work starts, two rounds of revisions included, 14-day payment terms.",
      },
    },
  },
  email_responder: {
    fr: {
      client: { name: "Atelier Dumas", sector: "Menuiserie" },
      values: {
        email: "Bonjour,\nCela fait trois semaines que nous attendons la mise en ligne du nouveau catalogue, qui était prévue le 1er octobre. Personne ne nous a prévenus du retard. Nous avons une salon professionnel le 5 novembre et nous comptons dessus. Pouvez-vous nous dire ce qu'il se passe ?\nCordialement,\nPaul Dumas",
        client: "c",
        intent: "S'excuser, expliquer que les photos produits sont arrivées en retard, proposer une mise en ligne le 28 octobre et un point téléphonique.",
      },
    },
    en: {
      values: {
        email: "Hi,\nI was charged twice for my October subscription (£49 each, on Oct 2 and Oct 3). Can you please refund the duplicate payment? I've attached my bank statement.\nThanks,\nLaura",
        intent: "Apologise, confirm the duplicate charge will be refunded within 5 working days.",
      },
    },
  },
  feedback_synthesis: {
    fr: {
      values: {
        text: "« Livraison rapide, produit conforme. » 5/5\n« Le service client ne répond pas au téléphone, j'ai dû écrire trois fois. » 2/5\n« Très bon rapport qualité-prix. » 4/5\n« Colis arrivé abîmé, mais remplacé rapidement. » 4/5\n« Impossible de joindre quelqu'un pour modifier ma commande. » 1/5\n« Le site est clair et la commande facile. » 5/5\n« Délai de livraison plus long qu'annoncé (8 jours au lieu de 3). » 2/5\n« Je recommande, l'équipe est sympathique en boutique. » 5/5",
        context: "Avis Google, septembre 2026, boutique en ligne",
      },
    },
    en: {
      values: {
        text: "\"The app is fast and easy to use.\"\n\"Support took 4 days to answer my ticket.\"\n\"Love the new dashboard!\"\n\"Pricing went up 20% without warning.\"\n\"Export to Excel keeps failing on large reports.\"\n\"Great onboarding call, very helpful.\"\n\"Still waiting for a fix on the Excel export bug.\"\n\"Good value compared to competitors.\"",
        context: "Customer emails and app store reviews, Q3 2026",
      },
    },
  },
  meeting_minutes: {
    fr: {
      values: {
        notes: "Point hebdo équipe projets — lundi 19/10\nprésents : Julie, Marc, Inès, Thomas\n- Vernet : maquette validée par le client vendredi. Dev commence lundi prochain. Marc lead.\n- Marchand : retard photos produits, mise en ligne décalée au 28/10. Julie prévient le client aujourd'hui.\n- Recrutement chargé de projet : 2 entretiens jeudi (Inès)\n- On décide de passer les points hebdo à 30 min max\n- Thomas : question ouverte sur l'achat d'une licence Figma supplémentaire, à voir avec la direction",
        meeting: "Point hebdo projets, 19 octobre 2026",
        attendees: "Julie, Marc, Inès, Thomas",
      },
    },
    en: {
      values: {
        notes: "Sales sync Oct 19 — Tom, Priya, Ben\n- Q4 pipeline at £310k, target £350k\n- Northwind pilot: Priya sends proposal by Friday\n- Agreed: discount cap 10% without manager approval\n- Ben to update CRM stages by end of month\n- Open: do we attend the Retail Tech fair in November? Need budget answer from finance",
        meeting: "Weekly sales sync",
        attendees: "Tom, Priya, Ben",
      },
    },
  },
  weekly_dashboard: {
    fr: {
      values: { data: "1 fichier joint", week: "Semaine 42 (12–18 octobre 2026)", kpis: "Chiffre d'affaires, nouveaux clients, tickets support ouverts" },
      files: [
        { name: "kpi-hebdo.csv", text: "Semaine;CA (€);Nouveaux clients;Tickets ouverts\nS37;14200;3;18\nS38;15100;2;22\nS39;13800;4;19\nS40;16900;5;25\nS41;15400;3;31\nS42;17600;6;27" },
      ],
    },
    en: {
      values: { data: "1 attached file", week: "Week 42", kpis: "Revenue, active users, churned accounts" },
      files: [{ name: "weekly-kpis.csv", text: "Week,Revenue (£),Active users,Churned accounts\nW37,21500,1840,2\nW38,22100,1872,1\nW39,21900,1901,3\nW40,23400,1955,0\nW41,22800,1990,4\nW42,24600,2034,1" }],
    },
  },
};

const NUMERIC_SCORE = /\b\d{1,3}(?:[.,]\d)?\s?\/\s?(?:5|10|20|100)\b/;
const PREFERENCE = /meilleur(e)? candidat|candidat(e)? (le|la) plus|premier choix|best candidate|strongest candidate|top candidate|first choice|we recommend hiring|recommend(ed)? (hiring|rejecting)/i;
const LEGAL_REMINDER = /juriste|avocat|professionnel du droit|professionnel(le)? du droit|conseil juridique|legal professional|lawyer|solicitor|legal advice/i;

function chartOf(answer: string) {
  const block = /```chart\s*\n([\s\S]*?)```/.exec(answer)?.[1];
  return block ? parseChartSpec(block) : null;
}

async function run(key: string, lang: Lang) {
  const agent = builtinAgent(key)!;
  const example = EXAMPLES[key][lang];
  const messages = lang === "fr" ? fr : en;
  const launch = (messages.tools.launch as Launch)[key];
  const message = composeRunMessage(
    agent.fields.map((f) => ({ ...f, options: f.options })),
    example.values,
    () => example.client?.name ?? null,
    { field: (f) => launch.fields?.[f.key] ?? f.label, option: (f, o) => launch.options?.[f.key]?.[o] ?? o, colon: lang === "fr" ? " : " : ": " },
  );
  const knowledge: KnowledgePassage[] = example.knowledge
    ? [
        {
          position: 1,
          sourceType: "memory_entry",
          id: "smoke",
          documentId: null,
          spaceId: "smoke",
          spaceKind: "client",
          clientName: example.client?.name ?? null,
          title: lang === "fr" ? "Historique du compte" : "Account history",
          content: example.knowledge,
          page: null,
          charStart: null,
          charEnd: null,
          sourceDate: "2026-09-30",
        },
      ]
    : [];
  const system = buildSystemPrompt({
    company: { name: lang === "fr" ? "Agence Lumen" : "Pixel & Co", industry: lang === "fr" ? "Agence web" : "Web agency" },
    client: example.client ?? null,
    user: { name: lang === "fr" ? "Olivier" : "Oliver" },
    locale: lang,
    today: "2026-10-20",
    knowledge,
    tool: { name: launch.name, instructions: agent.instructions, format: outputFormatInstruction(agent.outputFormat) },
  });
  const files = (example.files ?? []).map((f) => `<attachment name="${f.name}">\n${f.text}\n</attachment>`);
  const text = [message, ...files].join("\n\n");

  let answer = "";
  let error: string | null = null;
  for await (const e of getProvider("openai").stream(
    { apiModelId: MODEL, system, messages: [{ role: "user", content: [{ type: "text", text }] }], maxOutputTokens: Number(process.env.SMOKE_MAX_TOKENS ?? 12_000) },
    new AbortController().signal,
  )) {
    if (e.type === "text") answer += e.delta;
    if (e.type === "error") error = e.error.code;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${key}.${lang}.md`), `# ${launch.name} (${lang})\n\n## Form message\n\n${text}\n\n## Answer (${MODEL})\n\n${answer}\n${error ? `\nERROR: ${error}\n` : ""}`);
  return { answer, error };
}

const configured = getProvider("openai").isConfigured();

describe.skipIf(!configured).concurrent(`launch agents with a real model (${MODEL})`, () => {
  const cases = BUILTIN_AGENTS.flatMap((a) => (["fr", "en"] as const).map((lang) => [a.key, lang] as const));

  it.each(cases)("%s answers a realistic %s example as asked", { timeout: 240_000 }, async (key, lang) => {
    const { answer, error } = await run(key, lang);
    if (error === "provider_quota") {
      console.warn(`${key}/${lang}: provider account out of credits (provider_quota)`);
      return;
    }
    expect(error).toBeNull();
    expect(answer.length).toBeGreaterThan(300);
    // The answer is in the person's language.
    if (lang === "fr") expect(answer).toMatch(/\b(le|la|les|des|et|du)\b/i);
    else expect(answer).toMatch(/\b(the|and|of|to)\b/i);

    const agent = builtinAgent(key)!;
    if (agent.outputFormat === "table") expect(hasTable(answer), "a Markdown table").toBe(true);
    if (key === "invoice_intake") {
      const table = tablesOf(markdownToBlocks(answer))[0];
      expect(table.header.length).toBeGreaterThanOrEqual(10);
      expect(table.rows.length).toBeGreaterThanOrEqual(3);
    }
    if (["contract_review", "feedback_synthesis", "meeting_minutes", "weekly_dashboard"].includes(key)) expect(hasTable(answer), "a Markdown table").toBe(true);
    if (["cash_flow_forecast", "margin_analysis", "weekly_dashboard"].includes(key)) {
      const chart = chartOf(answer);
      expect(chart, "a valid chart block").not.toBeNull();
      if (key === "cash_flow_forecast") expect(chart!.labels.length).toBeGreaterThanOrEqual(6);
    }
    if (key === "meeting_prep") expect(answer).toMatch(/\[S1\]/);
    if (key === "payment_reminders" || key === "email_responder") expect(answer).toMatch(/objet|subject/i);
    if (agent.notice === "legal") expect(answer.slice(-600)).toMatch(LEGAL_REMINDER);
    if (key === "application_review") {
      expect(answer).not.toMatch(NUMERIC_SCORE);
      expect(answer).not.toMatch(PREFERENCE);
      expect(answer.slice(-400)).toMatch(lang === "fr" ? /personne|humain/i : /person|human/i);
    }
  });
});
