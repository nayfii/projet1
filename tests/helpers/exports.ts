import { strToU8, zipSync } from "fflate";

/**
 * SYNTHETIC exports of former AI tools, shaped like the real ones (ChatGPT, Claude, Google Takeout for
 * Gemini, Perplexity's Markdown threads). Professional knowledge is deliberately mixed with private
 * content (health, love life, family, a password, a bank number) to test the privacy filter.
 * Every name, number and fact here is invented.
 */

const day = (iso: string) => new Date(iso).getTime() / 1000;

function chatgptConversation(id: string, title: string, at: string, userMessages: string[], options: { branch?: string } = {}) {
  const mapping: Record<string, unknown> = { root: { id: "root", message: null, parent: null, children: [] } };
  let parent = "root";
  userMessages.forEach((text, i) => {
    const u = `${id}-u${i}`;
    const a = `${id}-a${i}`;
    mapping[u] = { id: u, parent, children: [a], message: { author: { role: "user" }, create_time: day(at) + i * 60, content: { content_type: "text", parts: [text] } } };
    mapping[a] = { id: a, parent: u, children: [], message: { author: { role: "assistant" }, create_time: day(at) + i * 60 + 5, content: { content_type: "text", parts: [`Réponse de l'assistant ${i}`] } } };
    parent = a;
  });
  if (options.branch) {
    // An edited prompt left on a side branch: not on the path to current_node.
    mapping[`${id}-old`] = { id: `${id}-old`, parent: "root", children: [], message: { author: { role: "user" }, create_time: day(at) - 10, content: { content_type: "text", parts: [options.branch] } } };
  }
  return { id, title, create_time: day(at), update_time: day(at) + 3600, mapping, current_node: parent };
}

export const CHATGPT_CONVERSATIONS = [
  chatgptConversation("c1", "Process devis agence", "2026-09-02T09:00:00Z", [
    "Dans notre agence Lumen, chaque devis est relu par un associé avant envoi et reste valable 30 jours.",
    "Je préfère des réponses courtes, en puces, avec un tableau quand il y a des chiffres.",
  ], { branch: "Ancienne version du message, abandonnée." }),
  chatgptConversation("c2", "Préparation rendez-vous client Atlas", "2026-09-10T14:00:00Z", [
    "Le client Atlas veut un reporting hebdomadaire court, le lundi matin. Leur budget annuel est de 48 000 euros.",
    "Mon identifiant pour leur extranet : login: claire.atlas mot de passe: Sup3rS3cret!",
  ]),
  chatgptConversation("c3", "Conseils santé", "2026-09-12T20:00:00Z", [
    "Mon médecin m'a parlé d'un traitement pour mon anxiété, j'ai des symptômes depuis des semaines.",
    "Est-ce que ce médicament est compatible avec ma grossesse ?",
  ]),
  chatgptConversation("c4", "Message pour Julien", "2026-09-15T22:00:00Z", [
    "Aide-moi à écrire un message à mon copain après notre dispute, notre relation amoureuse traverse un moment difficile.",
  ]),
  chatgptConversation("c5", "Mail relance facture", "2026-09-20T08:30:00Z", [
    "Rédige une relance pour la facture 2026-114. Notre délai de paiement standard est de 45 jours fin de mois.",
    "Pour info mon salaire a baissé ce mois-ci, mon crédit immobilier me coûte cher.",
    "Le ton de l'agence est direct et chaleureux, on tutoie les clients startups.",
  ]),
  chatgptConversation("c6", "ok", "2026-09-21T08:30:00Z", ["merci"]),
];

export const CLAUDE_CONVERSATIONS = [
  {
    uuid: "cl-1",
    name: "Onboarding des nouveaux clients",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T11:00:00Z",
    chat_messages: [
      { uuid: "m1", sender: "human", text: "Chez nous, l'onboarding d'un client se fait en trois ateliers : cadrage, accès, premier livrable sous 10 jours.", created_at: "2026-08-01T10:00:00Z" },
      { uuid: "m2", sender: "assistant", text: "Voici une proposition de plan…", created_at: "2026-08-01T10:00:10Z" },
      { uuid: "m3", sender: "human", text: "", content: [{ type: "text", text: "Le projet Refonte du site pour Atlas doit livrer la maquette le 15 mai." }], created_at: "2026-08-01T10:05:00Z" },
    ],
  },
  // Some exports use "messages" and "role".
  {
    uuid: "cl-2",
    name: "Notes perso",
    created_at: "2026-08-03T10:00:00Z",
    messages: [{ role: "user", text: "Je prie tous les soirs et ma religion compte beaucoup pour moi, je fais le ramadan cette année.", created_at: "2026-08-03T10:00:00Z" }],
  },
];

export const CLAUDE_PROJECTS = [
  {
    uuid: "p-1",
    name: "Propositions commerciales",
    description: "Rédaction des propositions commerciales de l'agence Lumen pour les PME industrielles.",
    prompt_template: "Toujours structurer en contexte, besoin, solution, planning, prix. Ton professionnel, phrases courtes.",
    created_at: "2026-07-01T10:00:00Z",
    docs: [{ filename: "contrat-client.pdf", content: "Contrat confidentiel d'un tiers." }],
  },
];

export const GEMINI_ACTIVITY = [
  { header: "Gemini Apps", title: "Prompted Résume les règles de notre politique de télétravail : deux jours par semaine, mardi et jeudi au bureau.", time: "2026-10-01T09:00:00.000Z", products: ["Gemini Apps"], safeHtmlItem: [{ html: "<p>Résumé…</p>" }] },
  { header: "Gemini Apps", title: "Prompted Quelle est la meilleure façon d'annoncer mon divorce à mes enfants ?", time: "2026-10-02T21:00:00.000Z", products: ["Gemini Apps"] },
  { header: "Search", title: "Searched for weather", time: "2026-10-02T21:00:00.000Z", products: ["Search"] },
];

export const PERPLEXITY_THREAD = [
  "# Quels sont les délais légaux de paiement entre entreprises en France ?",
  "",
  "En France, le délai de paiement entre professionnels est plafonné à 60 jours à compter de la date d'émission de la facture, ou 45 jours fin de mois si le contrat le prévoit.",
  "",
  "Sources : https://www.perplexity.ai/search/delais-paiement",
].join("\n");

const json = (value: unknown) => strToU8(JSON.stringify(value));

export function chatgptZip(): Uint8Array {
  return zipSync({
    "conversations.json": json(CHATGPT_CONVERSATIONS),
    "user.json": json({ id: "user-x", email: "claire@example.test" }),
    "chat.html": strToU8("<html><body>duplicate of conversations</body></html>"),
    "message_feedback.json": json([]),
  });
}

export function claudeZip(): Uint8Array {
  return zipSync({ "conversations.json": json(CLAUDE_CONVERSATIONS), "projects.json": json(CLAUDE_PROJECTS), "users.json": json([{ uuid: "u" }]) });
}

export function takeoutZip(): Uint8Array {
  return zipSync({
    "Takeout/My Activity/Gemini Apps/MyActivity.json": json(GEMINI_ACTIVITY),
    "Takeout/My Activity/Search/MyActivity.json": json([{ header: "Search", title: "Searched for x", time: "2026-10-01T00:00:00Z" }]),
    "Takeout/archive_browser.html": strToU8("<html>Takeout index</html>"),
  });
}

export function perplexityZip(): Uint8Array {
  return zipSync({ "Perplexity_Export/delais-paiement.md": strToU8(PERPLEXITY_THREAD) });
}

/** An archive with a path that climbs out of its folder, and a nested archive. */
export function hostileZip(): Uint8Array {
  return zipSync({
    "../../etc/evil.md": strToU8("# Evil\n\nThis path tries to escape the folder it is extracted to, it must be ignored."),
    "inner.zip": zipSync({ "a.txt": strToU8("nested") }),
    "notes/process.md": strToU8("# Process qualité\n\nChaque livrable passe par une relecture croisée avant envoi au client."),
  });
}

/** A "zip bomb": a small archive that decompresses to a huge file. */
export function bombZip(megabytes = 120): Uint8Array {
  return zipSync({ "conversations.json": new Uint8Array(megabytes * 1024 * 1024).fill(32) }, { level: 9 });
}

/** A File the way a browser gives it (Node 20+ has File, Blob.stream and arrayBuffer). */
export function asFile(bytes: Uint8Array | string, name: string): File {
  return new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name);
}
