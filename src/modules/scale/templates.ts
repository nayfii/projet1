import { block, type Block } from "./logic/blocks";
import type { Axis, Horizon, MetricSource, TestCategory } from "./types";

/**
 * Starting points offered in Scale. They hold structure and guidance only (headings, prompts shown
 * while a field is empty), never invented results, customers, revenue or launch dates.
 */

type Locale = "fr" | "en";
type L = { fr: string; en: string };
const pick = (l: L, locale: Locale) => l[locale];

// ─── Documents ──────────────────────────────────────────────────────────────

export const DOC_TEMPLATES = ["vision", "icp", "value_prop", "competition", "offer_pricing", "business_plan", "acquisition", "launch", "meeting_notes", "decision_log", "blank"] as const;
export type DocTemplate = (typeof DOC_TEMPLATES)[number];

const H = (fr: string, en: string): L => ({ fr, en });

function docBlocks(key: DocTemplate, locale: Locale): Block[] {
  const t = (fr: string, en: string) => (locale === "fr" ? fr : en);
  const h2 = (fr: string, en: string) => block("h2", t(fr, en));
  const p = (fr: string, en: string) => block("p", "", { hint: t(fr, en) });
  const hyp = (fr: string, en: string, text = "") => block("hypothesis", text, { hint: t(fr, en) });
  const fact = (fr: string, en: string) => block("fact", "", { hint: t(fr, en) });
  const dec = (fr: string, en: string) => block("decision", "", { hint: t(fr, en) });
  const check = (fr: string, en: string) => block("check", t(fr, en), { checked: false });
  const table = (head: string[]) => block("table", "", { rows: [head, head.map(() => ""), head.map(() => "")] });

  switch (key) {
    case "vision":
      return [
        h2("Vision", "Vision"),
        p("Ce que Cendr change pour une entreprise dans trois ans, en deux ou trois phrases.", "What Cendr changes for a company in three years, in two or three sentences."),
        h2("Pour qui", "For whom"),
        hyp("Le client visé en premier, tel que nous le pensons aujourd'hui.", "The first customer we aim at, as we see it today."),
        h2("Positionnement", "Positioning"),
        p("Pour [qui], qui [besoin], Cendr est [catégorie] qui [bénéfice]. Contrairement à [alternative], nous [différence].", "For [who], who [need], Cendr is [category] that [benefit]. Unlike [alternative], we [difference]."),
        h2("Ce que nous ne faisons pas", "What we do not do"),
        block("bullet", "", { hint: t("Un choix assumé par ligne.", "One deliberate choice per line.") }),
        h2("Faits observés", "Observed facts"),
        fact("Ce que des clients ou des tests ont réellement montré, avec la source.", "What customers or tests have actually shown, with the source."),
      ];
    case "icp":
      return [
        h2("Segment initial", "Initial segment"),
        hyp(
          "Hypothèse de cible, à valider par des entretiens.",
          "Target hypothesis, to be validated in interviews.",
          t("Agences marketing indépendantes françaises de 10 à 25 salariés.", "Independent French marketing agencies with 10 to 25 employees."),
        ),
        h2("Segments envisagés", "Segments considered"),
        table(t("Segment|Taille|Problème principal|Comment les joindre|Statut", "Segment|Size|Main problem|How to reach them|Status").split("|")),
        h2("Critères de qualification", "Qualifying criteria"),
        check("Utilise déjà des IA au quotidien", "Already uses AI every day"),
        check("Partage du contexte client entre plusieurs personnes", "Shares customer context between several people"),
        check("Décideur joignable", "Decision maker reachable"),
        h2("Ce que les entretiens ont montré", "What interviews showed"),
        fact("Une observation par bloc, avec la date et l'entretien.", "One observation per block, with the date and the interview."),
      ];
    case "value_prop":
      return [
        h2("Hypothèses de valeur", "Value hypotheses"),
        hyp("À tester.", "To be tested.", t("Cendr fait gagner du temps sur les livrables récurrents.", "Cendr saves time on recurring deliverables.")),
        hyp("À tester.", "To be tested.", t("Cendr améliore la qualité des livrables.", "Cendr improves the quality of deliverables.")),
        hyp("À tester.", "To be tested.", t("Consciousness évite de réexpliquer le contexte client.", "Consciousness avoids explaining the customer context again.")),
        hyp("À tester.", "To be tested.", t("Cendr permet de maîtriser les coûts d'IA de l'entreprise.", "Cendr keeps the company's AI costs under control.")),
        h2("Preuves", "Evidence"),
        fact("Résultat d'un test ou d'un pilote, avec le lien vers le test.", "Result of a test or a pilot, with the link to the test."),
        h2("Pour qui la valeur est la plus forte", "For whom the value is strongest"),
        p("Rôles, situations, moments.", "Roles, situations, moments."),
      ];
    case "competition":
      return [
        h2("Alternatives du client", "The customer's alternatives"),
        p("Ce que le client utilise aujourd'hui à la place de Cendr (outils, méthodes, rien).", "What the customer uses today instead of Cendr (tools, methods, nothing)."),
        table(t("Alternative|Forces|Faiblesses|Prix constaté|Ce qui nous distingue", "Alternative|Strengths|Weaknesses|Price seen|What sets us apart").split("|")),
        h2("Différenciation", "Differentiation"),
        hyp("Ce qui nous distingue, à confirmer auprès des clients.", "What sets us apart, to be confirmed with customers."),
        h2("Sources", "Sources"),
        block("link", "", { url: "", hint: t("Lien vers une page de prix, un comparatif…", "Link to a pricing page, a comparison…") }),
      ];
    case "offer_pricing":
      return [
        h2("Offre", "Offer"),
        p("Ce que le client achète, ce qui est inclus, ce qui ne l'est pas.", "What the customer buys, what is included, what is not."),
        h2("Tarification envisagée", "Pricing considered"),
        hyp("Prix et unité de facturation envisagés, à tester.", "Price and billing unit considered, to be tested."),
        table(t("Formule|Pour qui|Prix par siège|Crédits inclus|Options", "Plan|For whom|Price per seat|Credits included|Add-ons").split("|")),
        h2("Volonté de payer observée", "Willingness to pay observed"),
        fact("Ce que des prospects ont dit ou fait face à un prix.", "What prospects said or did when facing a price."),
        h2("Décision", "Decision"),
        dec("Le prix retenu et sa date de réévaluation.", "The price chosen and when to review it."),
      ];
    case "business_plan":
      return [
        h2("1. Client et problème", "1. Customer and problem"),
        hyp("Qui a le problème, à quelle fréquence, avec quelle intensité.", "Who has the problem, how often, how strongly."),
        fact("Ce que les entretiens ont confirmé ou infirmé.", "What interviews confirmed or contradicted."),
        h2("2. Solution et bénéfices attendus", "2. Solution and expected benefits"),
        p("Ce que fait Cendr et le résultat attendu pour le client.", "What Cendr does and the result expected for the customer."),
        h2("3. Alternatives et différenciation", "3. Alternatives and differentiation"),
        p("Voir aussi l'analyse concurrentielle.", "See also the competitive analysis."),
        h2("4. Revenus et tarification", "4. Revenue and pricing"),
        hyp("Prix, unité, nombre d'utilisateurs par client.", "Price, unit, users per customer."),
        h2("5. Acquisition et vente", "5. Acquisition and sales"),
        hyp("Canaux, cycle de vente, conversion attendue.", "Channels, sales cycle, expected conversion."),
        h2("6. Coûts et ressources", "6. Costs and resources"),
        p("Coûts fixes, coûts d'usage des modèles, temps de l'équipe.", "Fixed costs, model usage costs, team time."),
        h2("7. Hypothèses financières", "7. Financial hypotheses"),
        p("Les chiffres utilisés dans les simulations (Indicateurs → Simulations), avec leur source.", "The figures used in simulations (Indicators → Simulations), with their source."),
        h2("8. Risques et points à valider", "8. Risks and points to validate"),
        block("check", "", { checked: false, hint: t("Un point à valider par ligne, relié à un test si possible.", "One point to validate per line, linked to a test where possible.") }),
        h2("9. Jalons et financement", "9. Milestones and funding"),
        p("Les prochains jalons et, si besoin, le financement nécessaire pour les atteindre.", "The next milestones and, if needed, the funding required to reach them."),
      ];
    case "acquisition":
      return [
        h2("Canaux envisagés", "Channels considered"),
        table(t("Canal|Hypothèse|Coût estimé|Test lié|Statut", "Channel|Hypothesis|Estimated cost|Linked test|Status").split("|")),
        h2("Message", "Message"),
        hyp("Le message qui doit déclencher l'intérêt du segment visé.", "The message expected to spark the target segment's interest."),
        h2("Ce que nous avons appris", "What we learned"),
        fact("Résultats des expériences d'acquisition.", "Results of acquisition experiments."),
      ];
    case "launch":
      return [
        h2("Conditions de lancement", "Launch conditions"),
        p("Ce qui doit être vrai pour lancer (à décider, sans date imposée).", "What must be true to launch (to be decided, no date imposed)."),
        h2("Préparation", "Preparation"),
        check("Offre et prix validés", "Offer and price validated"),
        check("Parcours d'arrivée d'un client testé", "Customer onboarding tested"),
        check("Support client prêt", "Customer support ready"),
        check("Facturation prête", "Billing ready"),
        check("Mentions légales et documents à jour", "Legal notices and documents up to date"),
        h2("Décision de lancement", "Launch decision"),
        dec("Date et périmètre décidés, avec les preuves.", "Date and scope decided, with the evidence."),
      ];
    case "meeting_notes":
      return [
        block("p", "", { hint: t("Date, participants.", "Date, participants.") }),
        h2("Points abordés", "Topics"),
        block("bullet", ""),
        h2("Décisions", "Decisions"),
        dec("Ce qui a été décidé.", "What was decided."),
        h2("Actions", "Actions"),
        block("check", "", { checked: false, hint: t("Action — responsable.", "Action — owner.") }),
      ];
    default:
      return [block("p", "")];
  }
}

const DOC_TITLES: Record<DocTemplate, L> = {
  vision: H("Vision et positionnement", "Vision and positioning"),
  icp: H("ICP et segments envisagés", "ICP and segments considered"),
  value_prop: H("Proposition de valeur", "Value proposition"),
  competition: H("Analyse concurrentielle", "Competitive analysis"),
  offer_pricing: H("Offre et tarification", "Offer and pricing"),
  business_plan: H("Business plan", "Business plan"),
  acquisition: H("Stratégie d'acquisition", "Acquisition strategy"),
  launch: H("Préparation du lancement", "Launch preparation"),
  meeting_notes: H("Compte rendu", "Meeting notes"),
  decision_log: H("Journal des décisions", "Decision log"),
  blank: H("Document sans titre", "Untitled document"),
};

export function docTemplate(key: DocTemplate, locale: Locale): { title: string; content: Block[] } {
  return { title: pick(DOC_TITLES[key], locale), content: docBlocks(key, locale) };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

export const TEST_TEMPLATES = ["icp_interview", "with_without", "consciousness", "price", "channel", "usage_cost"] as const;
export type TestTemplate = (typeof TEST_TEMPLATES)[number];

type TestTemplateDef = {
  title: L;
  category: TestCategory;
  protocol: L;
  metrics: L;
  hints: { hypothesis: L; success: L; baseline: L };
  comparison?: boolean;
};

const TESTS: Record<TestTemplate, TestTemplateDef> = {
  icp_interview: {
    title: H("Entretien de découverte ICP", "ICP discovery interview"),
    category: "icp",
    protocol: H(
      "1. Recruter des personnes du segment (sans présenter Cendr).\n2. Entretien de 30 min : leur journée, les livrables récurrents, ce qui leur coûte du temps, les outils actuels, ce qu'ils ont déjà essayé.\n3. Noter les problèmes cités spontanément et leur intensité (1 à 5).\n4. Ne pas vendre : poser des questions sur le passé, pas sur des intentions.",
      "1. Recruit people from the segment (without presenting Cendr).\n2. 30-min interview: their day, recurring deliverables, what costs them time, current tools, what they already tried.\n3. Note the problems mentioned unprompted and their intensity (1 to 5).\n4. Do not sell: ask about the past, not about intentions.",
    ),
    metrics: H(
      "Entretiens menés ; problèmes cités spontanément ; intensité moyenne ; outils et budget actuels.",
      "Interviews held; problems mentioned unprompted; average intensity; current tools and budget.",
    ),
    hints: {
      hypothesis: H("Ex. : les agences de 10 à 25 salariés perdent un temps important à réexpliquer le contexte client.", "E.g. agencies with 10 to 25 employees lose significant time re-explaining customer context."),
      success: H("À fixer avant le premier entretien. Ex. : au moins X entretiens sur Y citent ce problème spontanément.", "Set before the first interview. E.g. at least X of Y interviews mention the problem unprompted."),
      baseline: H("Ce que l'on sait déjà avant le test.", "What we already know before the test."),
    },
  },
  with_without: {
    title: H("Comparaison d'une tâche avec et sans Cendr", "A task with and without Cendr"),
    category: "value",
    protocol: H(
      "1. Choisir une tâche réelle et répétée (ex. un compte rendu client).\n2. La réaliser sans Cendr, puis avec Cendr, dans des conditions comparables (même personne ou même niveau, même type de client).\n3. Mesurer le temps, le coût, la qualité (1 à 5, évaluée par la même personne) et le nombre de corrections.\n4. Noter les conditions et tout ce qui fausse la comparaison.",
      "1. Pick a real, repeated task (e.g. a customer report).\n2. Do it without Cendr, then with Cendr, in comparable conditions (same person or level, same kind of customer).\n3. Measure time, cost, quality (1 to 5, rated by the same person) and number of corrections.\n4. Note the conditions and anything that skews the comparison.",
    ),
    metrics: H("Temps (min), coût, qualité (1–5), corrections nécessaires.", "Time (min), cost, quality (1–5), corrections needed."),
    hints: {
      hypothesis: H("Ex. : avec Cendr, la tâche prend nettement moins de temps à qualité égale.", "E.g. with Cendr the task takes much less time at equal quality."),
      success: H("Ex. : au moins X % de temps gagné sans baisse de qualité.", "E.g. at least X% time saved with no drop in quality."),
      baseline: H("Le temps et la qualité habituels sans Cendr.", "The usual time and quality without Cendr."),
    },
    comparison: true,
  },
  consciousness: {
    title: H("Test de Consciousness", "Consciousness test"),
    category: "product",
    protocol: H(
      "1. Choisir un client avec un historique réel dans Cendr.\n2. Demander une tâche qui suppose le contexte client, avec et sans Consciousness.\n3. Compter les informations correctes reprises sans les réexpliquer, les erreurs et le temps de reprise.",
      "1. Pick a customer with real history in Cendr.\n2. Ask for a task that needs the customer context, with and without Consciousness.\n3. Count the correct facts reused without re-explaining, the errors and the time to get going.",
    ),
    metrics: H("Informations reprises correctement ; erreurs ; temps de reprise ; avis de l'utilisateur.", "Facts reused correctly; errors; time to get going; user's opinion."),
    hints: {
      hypothesis: H("Ex. : Consciousness évite de réexpliquer le contexte client.", "E.g. Consciousness avoids explaining the customer context again."),
      success: H("À fixer avant le test.", "Set before the test."),
      baseline: H("Comment le contexte est transmis aujourd'hui.", "How context is passed on today."),
    },
    comparison: true,
  },
  price: {
    title: H("Test de prix et de volonté de payer", "Price and willingness-to-pay test"),
    category: "price",
    protocol: H(
      "1. Présenter l'offre avec un prix précis (pas une fourchette).\n2. Observer la réaction et demander un engagement concret (pilote payant, signature, rendez-vous avec le décideur).\n3. Noter le prix présenté, la réponse et l'engagement obtenu.",
      "1. Present the offer with a precise price (not a range).\n2. Watch the reaction and ask for a concrete commitment (paid pilot, signature, meeting with the decision maker).\n3. Note the price shown, the answer and the commitment obtained.",
    ),
    metrics: H("Prix présenté ; réponses ; engagements concrets obtenus.", "Price shown; answers; concrete commitments obtained."),
    hints: {
      hypothesis: H("Ex. : les agences du segment acceptent X € par utilisateur et par mois.", "E.g. agencies in the segment accept €X per user per month."),
      success: H("Ex. : X prospects sur Y acceptent un pilote payant à ce prix.", "E.g. X of Y prospects accept a paid pilot at this price."),
      baseline: H("Ce que les prospects paient aujourd'hui pour leurs outils d'IA.", "What prospects pay today for their AI tools."),
    },
  },
  channel: {
    title: H("Test de canal d'acquisition", "Acquisition channel test"),
    category: "acquisition",
    protocol: H(
      "1. Choisir un canal et une audience précise.\n2. Fixer un budget et une durée.\n3. Mesurer contacts, réponses, rendez-vous et coût par rendez-vous.\n4. Décider : poursuivre, modifier ou arrêter.",
      "1. Pick a channel and a precise audience.\n2. Set a budget and a duration.\n3. Measure contacts, replies, meetings and cost per meeting.\n4. Decide: continue, adjust or stop.",
    ),
    metrics: H("Contacts ; réponses ; rendez-vous ; coût par rendez-vous.", "Contacts; replies; meetings; cost per meeting."),
    hints: {
      hypothesis: H("Ex. : ce canal obtient des rendez-vous qualifiés pour moins de X €.", "E.g. this channel gets qualified meetings for less than €X."),
      success: H("Ex. : au moins X rendez-vous qualifiés pour Y € dépensés.", "E.g. at least X qualified meetings for €Y spent."),
      baseline: H("Les résultats d'autres canaux, s'il y en a.", "Results from other channels, if any."),
    },
  },
  usage_cost: {
    title: H("Analyse du coût réel d'usage", "Real usage cost analysis"),
    category: "cost",
    protocol: H(
      "1. Choisir une période et des entreprises (pilotes ou démo).\n2. Relever les coûts d'IA estimés de la console (Plateforme → Usage) et le nombre d'utilisateurs actifs.\n3. Calculer le coût par utilisateur actif et le comparer au prix envisagé.",
      "1. Pick a period and companies (pilots or demo).\n2. Read the estimated AI costs in our console (Platform → Usage) and the number of active users.\n3. Work out the cost per active user and compare it with the price considered.",
    ),
    metrics: H("Coût d'IA estimé ; utilisateurs actifs ; coût par utilisateur ; part du prix.", "Estimated AI cost; active users; cost per user; share of the price."),
    hints: {
      hypothesis: H("Ex. : le coût d'usage reste sous X % du prix par utilisateur.", "E.g. usage cost stays under X% of the price per user."),
      success: H("À fixer avant l'analyse.", "Set before the analysis."),
      baseline: H("Coûts publics des modèles utilisés.", "Public prices of the models used."),
    },
  },
};

export function testTemplate(key: TestTemplate, locale: Locale) {
  const d = TESTS[key];
  return { title: pick(d.title, locale), category: d.category, protocol: pick(d.protocol, locale), metrics: pick(d.metrics, locale), comparison: Boolean(d.comparison) };
}

export function testHints(key: string | null, locale: Locale): { hypothesis: string; success: string; baseline: string } | null {
  const d = key && (TEST_TEMPLATES as readonly string[]).includes(key) ? TESTS[key as TestTemplate] : null;
  return d ? { hypothesis: pick(d.hints.hypothesis, locale), success: pick(d.hints.success, locale), baseline: pick(d.hints.baseline, locale) } : null;
}

export function testUsesComparison(key: string | null): boolean {
  return Boolean(key && (TEST_TEMPLATES as readonly string[]).includes(key) && TESTS[key as TestTemplate].comparison);
}

// ─── Suggested indicators (definitions only, no values) ─────────────────────

export const METRIC_SUGGESTIONS: { key: string; name: L; definition: L; unit: L; period: "week" | "month" | "total"; source: MetricSource }[] = [
  { key: "interviews", name: H("Entretiens réalisés", "Interviews held"), definition: H("Entretiens de découverte menés avec des personnes du segment visé.", "Discovery interviews held with people from the target segment."), unit: H("entretiens", "interviews"), period: "total", source: "manual" },
  { key: "tests_done", name: H("Tests terminés", "Tests finished"), definition: H("Tests au statut Terminé (compté dans Scale).", "Tests with the Finished status (counted in Scale)."), unit: H("tests", "tests"), period: "total", source: "tests_done" },
  { key: "tests_supported", name: H("Hypothèses soutenues", "Hypotheses supported"), definition: H("Tests dont la conclusion choisie est « Hypothèse soutenue ».", "Tests whose chosen conclusion is \"Hypothesis supported\"."), unit: H("tests", "tests"), period: "total", source: "tests_supported" },
  { key: "pilots", name: H("Pilotes actifs", "Active pilots"), definition: H("Entreprises clientes actives reliées comme pilote dans Scale.", "Active customer companies linked as a pilot in Scale."), unit: H("pilotes", "pilots"), period: "total", source: "pilots_active" },
  { key: "paying", name: H("Clients payants", "Paying customers"), definition: H("Entreprises qui paient un abonnement.", "Companies paying a subscription."), unit: H("clients", "customers"), period: "month", source: "manual" },
  { key: "conversion", name: H("Conversion commerciale", "Sales conversion"), definition: H("Part des prospects qualifiés devenus clients sur la période.", "Share of qualified prospects who became customers in the period."), unit: H("%", "%"), period: "month", source: "manual" },
  { key: "mrr", name: H("Revenus récurrents mensuels", "Monthly recurring revenue"), definition: H("Abonnements facturés sur le mois.", "Subscriptions billed in the month."), unit: H("€", "€"), period: "month", source: "manual" },
  { key: "spend", name: H("Dépenses", "Spending"), definition: H("Dépenses de l'entreprise sur le mois.", "Company spending in the month."), unit: H("€", "€"), period: "month", source: "manual" },
  { key: "ai_cost", name: H("Coût d'usage des modèles", "Model usage cost"), definition: H("Coût d'IA estimé du mois en cours, d'après la console (estimation, pas une facture).", "Estimated AI cost of the current month, from our console (an estimate, not an invoice)."), unit: H("$", "$"), period: "month", source: "ai_cost_month" },
  { key: "margin", name: H("Marge sur coûts directs", "Margin over direct costs"), definition: H("(Revenus − coûts directs) ÷ revenus, sur le mois.", "(Revenue − direct costs) ÷ revenue, in the month."), unit: H("%", "%"), period: "month", source: "manual" },
];

export function metricSuggestions(locale: Locale) {
  return METRIC_SUGGESTIONS.map((m) => ({ key: m.key, name: pick(m.name, locale), definition: pick(m.definition, locale), unit: pick(m.unit, locale), period: m.period, source: m.source }));
}

// ─── The Cendr starting structure ───────────────────────────────────────────

type StarterProject = { key: string; title: L; outcome: L; criterion: L; axis: Axis; horizon: Horizon; tasks: L[]; tests?: TestTemplate[]; docs?: DocTemplate[]; objective?: boolean };

const STARTER_PROJECTS: StarterProject[] = [
  {
    key: "icp",
    title: H("Définir et valider l'ICP", "Define and validate the ICP"),
    outcome: H("Un segment initial décrit précisément et confirmé par des entretiens.", "An initial segment described precisely and confirmed in interviews."),
    criterion: H("À définir avant les entretiens (nombre d'entretiens, problème cité spontanément…).", "To define before the interviews (number of interviews, problem mentioned unprompted…)."),
    axis: "market",
    horizon: "now",
    tasks: [H("Rédiger la grille d'entretien", "Write the interview guide"), H("Lister les agences à contacter", "List the agencies to contact"), H("Mener les entretiens de découverte", "Hold the discovery interviews"), H("Synthétiser les apprentissages", "Summarise what we learned")],
    tests: ["icp_interview"],
    docs: ["icp"],
    objective: true,
  },
  {
    key: "consciousness",
    title: H("Mesurer la valeur de Consciousness", "Measure the value of Consciousness"),
    outcome: H("Une mesure de ce que Consciousness change sur des tâches réelles.", "A measure of what Consciousness changes on real tasks."),
    criterion: H("À définir avant les mesures.", "To define before measuring."),
    axis: "product",
    horizon: "now",
    tasks: [H("Choisir des tâches réelles à comparer", "Choose real tasks to compare"), H("Fixer les conditions de comparaison", "Set the comparison conditions"), H("Mesurer avec et sans Cendr", "Measure with and without Cendr")],
    tests: ["with_without", "consciousness"],
    docs: ["value_prop"],
    objective: true,
  },
  {
    key: "offer",
    title: H("Construire l'offre et tester le prix", "Build the offer and test the price"),
    outcome: H("Une offre claire et un prix testé auprès de prospects.", "A clear offer and a price tested with prospects."),
    criterion: H("À définir (engagements obtenus à un prix donné…).", "To define (commitments obtained at a given price…)."),
    axis: "business",
    horizon: "next",
    tasks: [H("Rédiger l'offre", "Write the offer"), H("Définir les hypothèses de prix", "Define the price hypotheses"), H("Préparer le test de prix", "Prepare the price test")],
    tests: ["price"],
    docs: ["offer_pricing"],
    objective: true,
  },
  {
    key: "pilot_ready",
    title: H("Préparer une version utilisable par des pilotes", "Prepare a version pilots can use"),
    outcome: H("Une version que des pilotes utilisent sans aide constante.", "A version pilots use without constant help."),
    criterion: H("À définir (parcours essentiels sans blocage…).", "To define (key journeys without blockers…)."),
    axis: "product",
    horizon: "now",
    tasks: [H("Lister ce qui bloquerait un pilote", "List what would block a pilot"), H("Corriger les points bloquants", "Fix the blocking points"), H("Préparer l'accompagnement au démarrage", "Prepare onboarding support")],
  },
  {
    key: "business_plan",
    title: H("Construire le business plan et le modèle de coûts", "Build the business plan and the cost model"),
    outcome: H("Un business plan dont chaque hypothèse est identifiée et reliée à un test.", "A business plan whose every hypothesis is identified and linked to a test."),
    criterion: H("À définir.", "To define."),
    axis: "business",
    horizon: "next",
    tasks: [H("Remplir le business plan", "Fill in the business plan"), H("Mesurer le coût réel d'usage", "Measure the real usage cost"), H("Créer une simulation économique", "Create an economic simulation")],
    tests: ["usage_cost"],
    docs: ["business_plan"],
  },
  {
    key: "pilots",
    title: H("Recruter et accompagner les premiers pilotes", "Recruit and support the first pilots"),
    outcome: H("Des pilotes actifs qui utilisent Cendr chaque semaine.", "Active pilots using Cendr every week."),
    criterion: H("À définir (nombre de pilotes, usage hebdomadaire…).", "To define (number of pilots, weekly use…)."),
    axis: "market",
    horizon: "next",
    tasks: [H("Définir le cadre d'un pilote", "Define the pilot framework"), H("Contacter les agences intéressées", "Contact interested agencies"), H("Organiser un point régulier avec chaque pilote", "Set up a regular check-in with each pilot")],
  },
  {
    key: "acquisition",
    title: H("Tester l'acquisition", "Test acquisition"),
    outcome: H("Un premier canal dont le coût et le rendement sont mesurés.", "A first channel whose cost and yield are measured."),
    criterion: H("À définir.", "To define."),
    axis: "acquisition",
    horizon: "later",
    tasks: [H("Lister les canaux possibles", "List possible channels"), H("Choisir un premier canal à tester", "Choose a first channel to test")],
    tests: ["channel"],
    docs: ["acquisition"],
  },
  {
    key: "operations",
    title: H("Préparer les opérations nécessaires au lancement", "Prepare the operations needed to launch"),
    outcome: H("Les prérequis du lancement prêts (support, facturation, documents).", "Launch prerequisites ready (support, billing, documents)."),
    criterion: H("À définir.", "To define."),
    axis: "operations",
    horizon: "later",
    tasks: [H("Lister les prérequis de lancement", "List launch prerequisites"), H("Préparer le support client", "Prepare customer support"), H("Préparer la facturation", "Prepare billing")],
    docs: ["launch"],
  },
];

export type StarterPlan = {
  objective: { title: string; description: string; metric: string };
  projects: { key: string; title: string; outcome: string; success_criterion: string; axis: Axis; horizon: Horizon; tasks: string[]; tests: TestTemplate[]; docs: DocTemplate[]; objective: boolean }[];
  weeklyReview: string;
  extraDocs: DocTemplate[];
};

export function starterPlan(locale: Locale): StarterPlan {
  return {
    objective: {
      title: pick(H("Valider la cible initiale et la valeur de Cendr", "Validate the initial target and the value of Cendr"), locale),
      description: pick(
        H("Suggestion de départ : à reformuler. Atteint seulement par une décision explicite, jamais par la fin des tâches.", "Starting suggestion: rephrase it. Reached only by an explicit decision, never by finishing tasks."),
        locale,
      ),
      metric: pick(H("Hypothèses de cible et de valeur soutenues par des tests", "Target and value hypotheses supported by tests"), locale),
    },
    projects: STARTER_PROJECTS.map((p) => ({
      key: p.key,
      title: pick(p.title, locale),
      outcome: pick(p.outcome, locale),
      success_criterion: pick(p.criterion, locale),
      axis: p.axis,
      horizon: p.horizon,
      tasks: p.tasks.map((t) => pick(t, locale)),
      tests: p.tests ?? [],
      docs: p.docs ?? [],
      objective: Boolean(p.objective),
    })),
    weeklyReview: pick(H("Revue hebdomadaire", "Weekly review"), locale),
    extraDocs: ["vision"],
  };
}
