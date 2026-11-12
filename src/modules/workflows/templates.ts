import type { WfEdge, WfGraph, WfNode } from "./graph";

/**
 * Ready-made workflows (CLAUDE.md §12): real graphs the person adapts. Connections, recipients and
 * memories are left for them to choose (the editor shows what is missing before Play).
 */

type Lang = "fr" | "en";
type Step = { type: string; config?: Record<string, unknown>; handle?: string; from?: number };

/** A chain of steps, each linked to the previous one (or to `from`, through `handle`). */
function chain(steps: Step[]): WfGraph {
  const nodes: WfNode[] = steps.map((s, i) => ({ id: `n${i + 1}`, type: s.type, position: { x: 0, y: 0 }, config: s.config ?? {} }));
  const edges: WfEdge[] = [];
  steps.forEach((s, i) => {
    if (i === 0) return;
    const source = s.from ?? i - 1;
    edges.push({ id: `e${i}`, source: `n${source + 1}`, target: `n${i + 1}`, handle: s.handle ?? "out" });
  });
  // Laid out top to bottom; branches side by side.
  const depth = new Map<string, number>([["n1", 0]]);
  const column = new Map<string, number>([["n1", 0]]);
  for (const e of edges) {
    depth.set(e.target, (depth.get(e.source) ?? 0) + 1);
    column.set(e.target, (column.get(e.source) ?? 0) + (e.handle === "false" ? 1 : 0));
  }
  for (const n of nodes) n.position = { x: (column.get(n.id) ?? 0) * 300, y: (depth.get(n.id) ?? 0) * 140 };
  return { nodes, edges };
}

const T = (fr: string, en: string) => (lang: Lang) => (lang === "fr" ? fr : en);

export const TEMPLATES: { key: string; category: string; graph: (lang: Lang) => WfGraph }[] = [
  {
    key: "email_digest",
    category: "email",
    graph: (l) =>
      chain([
        { type: "trigger.schedule", config: { frequency: "weekdays", time: "08:00" } },
        { type: "app.search_email", config: { query: "is:important newer_than:1d", limit: 15 } },
        { type: "ai.summarize", config: { input: "{{steps.n2.text}}", length: "medium" } },
        { type: "action.email_draft", config: { subject: T("Vos e-mails importants du jour", "Today's important e-mails")(l), body: "{{steps.n3.text}}" } },
      ]),
  },
  {
    key: "weekly_report",
    category: "reporting",
    graph: (l) =>
      chain([
        { type: "trigger.schedule", config: { frequency: "weekly", weekday: "1", time: "09:00" } },
        { type: "ai.memory", config: { query: T("décisions, avancées et risques de la semaine", "decisions, progress and risks of the week")(l), limit: 8 } },
        { type: "ai.generate", config: { prompt: T("Rédige le point hebdomadaire de l'équipe (avancées, décisions, risques, priorités) à partir de :\n{{steps.n2.text}}", "Write the team's weekly update (progress, decisions, risks, priorities) from:\n{{steps.n2.text}}")(l) } },
        { type: "action.slack_post", config: { text: "{{steps.n3.text}}" } },
      ]),
  },
  {
    key: "meeting_minutes",
    category: "minutes",
    graph: (l) =>
      chain([
        { type: "trigger.manual", config: { sample: T("Notes de la réunion avec Atlas : budget validé, lancement le 12 mars, Claire envoie le planning.", "Notes of the meeting with Atlas: budget approved, launch on 12 March, Claire sends the plan.")(l) } },
        { type: "ai.summarize", config: { input: "{{trigger.text}}", length: "long" } },
        { type: "ai.extract", config: { input: "{{trigger.text}}", fields: T("décisions, actions, responsables, échéances", "decisions, actions, owners, deadlines")(l).split(", ") } },
        { type: "action.memory_entry", config: { title: T("Compte rendu de réunion", "Meeting minutes")(l), content: "{{steps.n2.text}}" } },
      ]),
  },
  {
    key: "document_analysis",
    category: "documents",
    graph: (l) =>
      chain([
        { type: "trigger.manual", config: { sample: T("Identifiant du fichier à analyser", "Id of the file to analyse")(l) } },
        { type: "app.read_file", config: { file: "{{trigger.text}}" } },
        { type: "ai.generate", config: { prompt: T("Analyse ce document : points clés, risques, questions à poser.\n\n{{steps.n2.text}}", "Analyse this document: key points, risks, questions to ask.\n\n{{steps.n2.text}}")(l) } },
        { type: "action.memory_entry", config: { title: T("Analyse de {{steps.n2.name}}", "Analysis of {{steps.n2.name}}")(l), content: "{{steps.n3.text}}" } },
      ]),
  },
  {
    key: "prospecting",
    category: "sales",
    graph: (l) =>
      chain([
        { type: "trigger.manual", config: { sample: T("Prospect : Vega, PME industrielle, cherche à réduire ses délais de production.", "Prospect: Vega, industrial SME, wants shorter production times.")(l) } },
        { type: "ai.memory", config: { query: T("nos offres et références", "our offers and references")(l), limit: 5 } },
        { type: "ai.generate", config: { prompt: T("Rédige un premier e-mail de prospection court et personnalisé pour ce prospect :\n{{trigger.text}}\n\nAppuie-toi sur nos offres :\n{{steps.n2.text}}", "Write a short, personalised first prospecting e-mail for this prospect:\n{{trigger.text}}\n\nUse our offers:\n{{steps.n2.text}}")(l) } },
        { type: "action.email_draft", config: { subject: T("Une idée pour vous", "An idea for you")(l), body: "{{steps.n3.text}}" } },
      ]),
  },
  {
    key: "lead_triage",
    category: "leads",
    graph: (l) =>
      chain([
        { type: "trigger.webhook" },
        { type: "ai.classify", config: { input: "{{trigger.message}}", labels: T("chaud, tiède, froid", "hot, warm, cold")(l).split(", ") } },
        { type: "logic.condition", config: { left: "{{steps.n2.label}}", operator: "equals", right: T("chaud", "hot")(l) } },
        { type: "action.slack_post", config: { text: T("Nouveau lead chaud : {{trigger.name}} — {{trigger.message}}", "New hot lead: {{trigger.name}} — {{trigger.message}}")(l) }, handle: "true", from: 2 },
        { type: "action.memory_entry", config: { title: T("Lead : {{trigger.name}}", "Lead: {{trigger.name}}")(l), content: "{{trigger.message}}" }, handle: "false", from: 2 },
      ]),
  },
  {
    key: "team_notification",
    category: "notifications",
    graph: (l) =>
      chain([
        { type: "trigger.email", config: { query: "" } },
        { type: "ai.decide", config: { question: T("Ce message vient-il d'un client prioritaire ou demande-t-il une réponse urgente ?", "Is this message from a priority client, or does it need an urgent answer?")(l), input: "{{trigger.from}}\n{{trigger.subject}}\n{{trigger.snippet}}" } },
        { type: "action.slack_post", config: { text: T("Message prioritaire de {{trigger.from}} : {{trigger.subject}}", "Priority message from {{trigger.from}}: {{trigger.subject}}")(l) }, handle: "true", from: 1 },
      ]),
  },
  {
    key: "project_followup",
    category: "projects",
    graph: (l) =>
      chain([
        { type: "trigger.schedule", config: { frequency: "weekly", weekday: "5", time: "16:00" } },
        { type: "app.calendar_events", config: { days: 7 } },
        { type: "ai.generate", config: { prompt: T("Voici mes rendez-vous de la semaine prochaine :\n{{steps.n2.text}}\n\nPrépare la liste de ce qu'il faut préparer pour chacun.", "Here are my meetings next week:\n{{steps.n2.text}}\n\nList what to prepare for each one.")(l) } },
        { type: "action.email_draft", config: { subject: T("À préparer la semaine prochaine", "To prepare next week")(l), body: "{{steps.n3.text}}" } },
      ]),
  },
  {
    key: "content_creation",
    category: "content",
    graph: (l) =>
      chain([
        { type: "trigger.manual", config: { sample: T("Sujet : notre nouvelle offre d'accompagnement.", "Topic: our new support offer.")(l) } },
        { type: "ai.memory", config: { query: T("ton de la marque et offres", "brand tone and offers")(l), limit: 5 } },
        { type: "ai.generate", config: { prompt: T("Écris un post LinkedIn sur ce sujet, dans le ton de la marque :\n{{trigger.text}}\n\nRepères :\n{{steps.n2.text}}", "Write a LinkedIn post on this topic, in the brand's tone:\n{{trigger.text}}\n\nReferences:\n{{steps.n2.text}}")(l) } },
        { type: "action.notion_page", config: { title: T("Brouillon : post LinkedIn", "Draft: LinkedIn post")(l), text: "{{steps.n3.text}}" } },
      ]),
  },
  {
    key: "client_info",
    category: "clients",
    graph: (l) =>
      chain([
        { type: "trigger.email", config: { query: "" } },
        { type: "ai.extract", config: { input: "{{trigger.from}}\n{{trigger.subject}}\n{{trigger.snippet}}", fields: T("client, besoin, budget, echeance", "client, need, budget, deadline")(l).split(", ") } },
        { type: "logic.filter", config: { left: T("{{steps.n2.client}}", "{{steps.n2.client}}")(l), operator: "not_empty" } },
        { type: "action.memory_entry", config: { title: T("Info client : {{steps.n2.client}}", "Client info: {{steps.n2.client}}")(l), content: T("Besoin : {{steps.n2.besoin}} · Budget : {{steps.n2.budget}} · Échéance : {{steps.n2.echeance}}", "Need: {{steps.n2.need}} · Budget: {{steps.n2.budget}} · Deadline: {{steps.n2.deadline}}")(l) } },
      ]),
  },
];

export function templateGraph(key: string, lang: Lang): WfGraph | null {
  return TEMPLATES.find((t) => t.key === key)?.graph(lang) ?? null;
}
