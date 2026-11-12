import { detectCards, detectIbans } from "@/modules/hide/detectors/patterns";

/**
 * Privacy filter for imported knowledge (CLAUDE.md §12, "Vos connaissances, pas votre vie privée").
 * Deterministic and local to our server: nothing is sent to an AI to decide what is private.
 *
 * 1. Secrets (passwords, API keys, private keys, card and bank numbers) are always removed.
 * 2. Private topics (health, love life, intimate family matters, politics, religion, personal finance)
 *    are recognised from word lists in French and English. A conversation mostly about them is left
 *    out entirely; otherwise the paragraphs that touch them are removed before any analysis.
 * 3. After the analysis, every proposal is checked again: a secret or a clearly private proposal is
 *    dropped; a doubtful one is kept apart, unticked, for the person to decide.
 *
 * Word lists cannot catch everything: this reduces what reaches the analysis and the memory, it does
 * not guarantee that nothing private ever does. The person reviews every proposal before it is saved.
 */

export const PRIVATE_TOPICS = ["health", "intimate", "family", "politics", "religion", "finance"] as const;
export type PrivateTopic = (typeof PRIVATE_TOPICS)[number];

/** Folded: lower case, no accents, single spaces. Phrases match on word boundaries. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ");
}

const LEXICON: Record<PrivateTopic, string[]> = {
  health: [
    "maladie", "malade", "mon medecin", "ma medecin", "hopital", "diagnostic medical", "diagnostique", "symptome", "symptomes", "ordonnance", "cancer", "chimiotherapie",
    "depression", "depressif", "anxiete", "crise d angoisse", "attaque de panique", "therapie", "therapeute", "psychologue", "psychiatre", "antidepresseur", "enceinte", "grossesse",
    "fausse couche", "ivg", "fertilite", "fiv", "sante mentale", "medicament", "medicaments", "chirurgie", "handicap", "vih", "diabete", "arret maladie", "mon traitement", "trouble alimentaire",
    "illness", "my doctor", "hospital", "diagnosis", "symptom", "symptoms", "prescription", "chemotherapy", "depression", "depressed", "anxiety", "panic attack", "therapy", "therapist",
    "psychiatrist", "antidepressant", "pregnant", "pregnancy", "miscarriage", "abortion", "fertility", "ivf", "mental health", "medication", "surgery", "disability", "hiv", "diabetes",
    "sick leave", "eating disorder",
  ],
  intimate: [
    "petit ami", "petite amie", "mon copain", "ma copine", "mon mec", "relation amoureuse", "vie amoureuse", "vie sentimentale", "rupture amoureuse", "rendez vous galant", "premier rendez vous",
    "tinder", "bumble", "hinge", "sexuel", "sexuelle", "sexualite", "infidelite", "tromper mon", "amoureux de", "amoureuse de", "mon ex", "mon crush", "boyfriend", "girlfriend",
    "dating app", "first date", "love life", "romantic relationship", "breakup", "break up with", "sexual", "sexuality", "cheating on", "in love with", "my ex",
  ],
  family: [
    "mon mari", "ma femme", "mon epoux", "mon epouse", "mon fils", "ma fille", "mes enfants", "mon enfant", "ma mere", "mon pere", "mes parents", "ma soeur", "mon frere", "ma belle mere",
    "divorce", "divorcer", "garde des enfants", "pension alimentaire", "deuil", "enterrement", "obseques", "conflit familial", "dispute avec ma", "dispute avec mon",
    "my husband", "my wife", "my son", "my daughter", "my kids", "my children", "my child", "my mother", "my father", "my mom", "my dad", "my parents", "my sister", "my brother",
    "custody", "child support", "alimony", "funeral", "grief", "grieving",
  ],
  politics: [
    "je vote", "voter pour", "mon vote", "parti politique", "militant", "militante", "manifestation contre", "extreme droite", "extreme gauche", "mes opinions politiques", "mon engagement politique",
    "i vote", "vote for", "my vote", "political party", "my political views", "far right", "far left", "democrat", "republican", "activist",
  ],
  religion: [
    // Places of worship and "mon dieu" / "ma foi" are left out: they are client names or figures of speech too.
    "ma religion", "ma pratique religieuse", "priere", "prier", "ramadan", "careme", "pratiquant", "pratiquante", "croyant", "croyante", "bapteme",
    "my religion", "my faith", "prayer", "praying", "ramadan", "believer", "baptism",
  ],
  finance: [
    "mon salaire", "ma paie", "mon credit immobilier", "mon pret immobilier", "mes impots", "ma declaration d impots", "mon compte bancaire", "mon compte en banque", "mes dettes", "surendettement",
    "mon epargne", "mon decouvert", "mon patrimoine", "my salary", "my paycheck", "my mortgage", "my taxes", "my tax return", "my bank account", "my debt", "my debts", "my savings", "credit score",
    "my overdraft",
  ],
};

const TOPIC_PATTERNS: Record<PrivateTopic, RegExp> = Object.fromEntries(
  PRIVATE_TOPICS.map((topic) => [topic, new RegExp(`(?:^|[^a-z0-9])(?:${LEXICON[topic].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[^a-z0-9])`, "g")]),
) as Record<PrivateTopic, RegExp>;

/** Secrets: credentials, keys, card and bank numbers. Always removed, never analysed or stored. */
const SECRET_PATTERNS: RegExp[] = [
  /(?:mot de passe|password|passwd|pwd|passcode|code pin|pin code|code secret|identifiant|login)\s*[:=]\s*\S+/gi,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  // French social security number.
  /\b[12][ ]?\d{2}[ ]?(?:0[1-9]|1[0-2])[ ]?(?:\d{2}|2[AB])[ ]?\d{3}[ ]?\d{3}[ ]?\d{2}\b/g,
];

export function topicsIn(text: string): Map<PrivateTopic, number> {
  const folded = fold(text);
  const found = new Map<PrivateTopic, number>();
  for (const topic of PRIVATE_TOPICS) {
    const count = folded.match(TOPIC_PATTERNS[topic])?.length ?? 0;
    if (count > 0) found.set(topic, count);
  }
  return found;
}

/** Card and bank numbers, with their checksums (Luhn, mod 97), as Hide finds them. */
function bankSpans(text: string) {
  return [...detectCards(text), ...detectIbans(text)].sort((a, b) => b.start - a.start);
}

export function hasSecret(text: string): boolean {
  return (
    bankSpans(text).length > 0 ||
    SECRET_PATTERNS.some((p) => {
      p.lastIndex = 0;
      return p.test(text);
    })
  );
}

function removeSecrets(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = text;
  for (const span of bankSpans(out)) {
    out = `${out.slice(0, span.start)}[secret retiré]${out.slice(span.end)}`;
    removed++;
  }
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p, () => {
      removed++;
      return "[secret retiré]";
    });
  }
  return { text: out, removed };
}

export type FilterResult =
  | { kept: false; reason: "private"; topics: PrivateTopic[] }
  | { kept: true; text: string; removedParagraphs: number; removedSecrets: number; topics: PrivateTopic[] };

/**
 * Before any analysis. A conversation is left out when its title is about a private topic, or when
 * at least 40 % of its paragraphs are; otherwise the paragraphs that touch one are removed.
 */
export function filterImportedText(title: string, text: string): FilterResult {
  const titleTopics = topicsIn(title);
  const paragraphs = text.split(/\n{2,}|\n(?=\S)/).map((p) => p.trim()).filter(Boolean);
  const flagged = paragraphs.map((p) => topicsIn(p));
  const privateCount = flagged.filter((t) => t.size > 0).length;
  const topics = new Set<PrivateTopic>([...titleTopics.keys(), ...flagged.flatMap((t) => [...t.keys()])]);
  if (titleTopics.size > 0 || (paragraphs.length > 0 && privateCount / paragraphs.length >= 0.4)) {
    return { kept: false, reason: "private", topics: [...topics] };
  }
  const kept = paragraphs.filter((_, i) => flagged[i].size === 0).join("\n\n");
  const { text: clean, removed } = removeSecrets(kept);
  return { kept: true, text: clean, removedParagraphs: privateCount, removedSecrets: removed, topics: [...topics] };
}

export type ProposalCheck = "keep" | "doubtful" | "drop";

/**
 * After the analysis, on each proposal: a secret, or two signs of a private topic, drop it; one sign
 * keeps it apart, unticked ("à vérifier"), for the person to decide.
 */
export function checkProposal(title: string, content: string): ProposalCheck {
  const text = `${title}\n${content}`;
  if (hasSecret(text)) return "drop";
  const hits = [...topicsIn(text).values()].reduce((n, c) => n + c, 0);
  if (hits >= 2) return "drop";
  if (hits === 1) return "doubtful";
  return "keep";
}
