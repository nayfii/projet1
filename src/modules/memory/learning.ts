import { parseModelJson } from "./json";

/**
 * Learning (Cendr Consciousness): what an exchange teaches about a client, decided in two steps.
 * 1. A model reads the exchange and proposes candidate facts (LEARN_FACTS_SYSTEM).
 * 2. Deterministic rules decide what happens to each one (this file): learned, sent to the person for
 *    confirmation, kept private, or dropped. A model never decides alone that its own claim is a fact.
 */

export const FACT_KINDS = ["fact", "decision", "commitment", "preference", "contact", "procedure"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
/** Kinds stored on memory entries ("note" = written by a person, no structure). */
export type EntryKind = FactKind | "note";

export type FactAttributes = {
  amount?: number;
  currency?: string;
  date?: string;
  person?: string;
  role?: string;
  owner?: string;
  due?: string;
};

export type CandidateFact = {
  kind: FactKind;
  key: string;
  title: string;
  content: string;
  /** Who said it in the exchange: the person, or the assistant (its own claim). */
  statedBy: "user" | "assistant";
  /** What it is about: the client, the person themself (private), or something else. */
  about: "client" | "person" | "other";
  confidence: number;
  attributes: FactAttributes;
  /** When it became or becomes true (YYYY-MM-DD), when the exchange says so. */
  effectiveDate: string | null;
};

export const LEARN_FACTS_SYSTEM = [
  "Task: learn client facts.",
  "You read one exchange from a company's AI workspace, in a conversation about the client {CLIENT}. Extract the lasting facts about this client that colleagues will need later, whichever AI model they use next.",
  "Keep: decisions (with who decided and when if said), commitments and deadlines (with owner and due date), budgets and amounts, key dates (launch, renewal, delivery), contacts and their roles, preferences and constraints, project context.",
  "Leave out: the question itself, greetings, drafts, generic advice, brainstorming, opinions, anything hypothetical or uncertain, anything about the person writing (their own life, mood, private matters), and anything not about this client.",
  'For each fact, say who stated it: "user" when the person wrote it in their message, "assistant" when only the assistant\'s answer says it (its own suggestion, estimate or claim).',
  'For each fact, say what it is about: "client" for anything about the client, its people and contacts included (a contact person at the client is "client"); "writer" only for the person writing themself (their own life, health, preferences or contact details); "other" for anything else.',
  'Give each fact a short stable key in English snake_case naming what it is about, so a later change replaces it: "budget", "launch_date", "contract_end", "decision:hosting_provider", "contact:jean_dupont", "deadline:proposal". Reuse the key of a known fact when the exchange changes or confirms it.',
  "Write each fact as it stands now, with its current value only: never the earlier value it replaces (Cendr keeps the history).",
  "Known facts about this client (key — fact):",
  "{KNOWN}",
  'Return ONLY JSON: an array of at most 6 objects {"kind": "fact|decision|commitment|preference|contact|procedure", "key": "…", "title": "short title, max 80 characters", "content": "the fact in 1 or 2 self-contained sentences, with its date when known", "stated_by": "user|assistant", "about": "client|writer|other", "confidence": 0 to 1, "attributes": {"amount": number, "currency": "EUR", "date": "YYYY-MM-DD", "person": "…", "role": "…", "owner": "…", "due": "YYYY-MM-DD"} (only the ones that apply), "effective_date": "YYYY-MM-DD or null"}, written in the language of the exchange. Return [] when there is nothing worth keeping, which is often the case.',
].join("\n");

/** Fills the client name and the facts already known (so the model reuses their keys). */
export function learnFactsSystem(client: string, known: { key: string; content: string }[]): string {
  const list = known.length ? known.map((k) => `- ${k.key} — ${k.content.replace(/\s+/g, " ").slice(0, 240)}`).join("\n") : "(none yet)";
  return LEARN_FACTS_SYSTEM.replace("{CLIENT}", client).replace("{KNOWN}", list);
}

/** A stable subject key: lowercase ASCII, words joined by "_", an optional "type:" prefix. */
export function normalizeSubjectKey(raw: string): string | null {
  const folded = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  const parts = folded.split(":").slice(0, 2).map((p) =>
    p
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80),
  );
  const key = parts.filter(Boolean).join(":");
  return key.length > 0 ? key.slice(0, 120) : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanAttributes(raw: unknown, restore: (s: string) => string): FactAttributes {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: FactAttributes = {};
  if (typeof r.amount === "number" && Number.isFinite(r.amount)) out.amount = r.amount;
  else if (typeof r.amount === "string" && /^-?[\d\s.,]+$/.test(r.amount)) {
    const n = Number(r.amount.replace(/\s/g, "").replace(/,(\d{1,2})$/, ".$1").replace(/,/g, ""));
    if (Number.isFinite(n)) out.amount = n;
  }
  for (const k of ["currency", "person", "role", "owner"] as const) {
    if (typeof r[k] === "string" && r[k].trim()) out[k] = restore(r[k]).trim().slice(0, 120);
  }
  for (const k of ["date", "due"] as const) {
    if (typeof r[k] === "string" && ISO_DATE.test(r[k])) out[k] = r[k];
  }
  return out;
}

/**
 * Reads the model's answer; anything malformed is dropped, never repaired into a fact. `restore`
 * puts Hide's real values back in each text field (and in the key, before it is normalised).
 */
/**
 * A key the model built from a Hide placeholder ("contact:person_1" for "[PERSON_1]"): the number
 * belongs to one conversation only, so the real value takes its place (else another conversation's
 * PERSON_1 would replace this contact).
 */
const PLACEHOLDER_IN_KEY = /(?<![a-z0-9])(iban|card|email|phone|amount|person|client|project|file|term)_(\d+)(?![0-9])/gi;

function restoreKey(key: string, restore: (s: string) => string): string {
  return restore(key).replace(PLACEHOLDER_IN_KEY, (found, category: string, n: string) => {
    const real = restore(`[${category.toUpperCase()}_${n}]`);
    return real.startsWith("[") ? found : real;
  });
}

export function parseCandidateFacts(text: string, restore: (s: string) => string = (s) => s): CandidateFact[] {
  const items = parseModelJson(text);
  if (!Array.isArray(items)) return [];
  const out: CandidateFact[] = [];
  for (const item of items.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const kind = FACT_KINDS.includes(i.kind as FactKind) ? (i.kind as FactKind) : "fact";
    const title = typeof i.title === "string" ? restore(i.title).trim().slice(0, 200) : "";
    const content = typeof i.content === "string" ? restore(i.content).trim().slice(0, 2000) : "";
    const key = normalizeSubjectKey(typeof i.key === "string" ? restoreKey(i.key, restore) : title);
    if (!title || !content || !key) continue;
    const confidence = typeof i.confidence === "number" && Number.isFinite(i.confidence) ? Math.min(Math.max(i.confidence, 0), 1) : 0.5;
    out.push({
      kind,
      key,
      title,
      content,
      statedBy: i.stated_by === "user" ? "user" : "assistant",
      // "writer" (asked) or "person" (older wording): the person writing themself, kept private.
      about: i.about === "client" ? "client" : i.about === "writer" || i.about === "person" ? "person" : "other",
      confidence,
      attributes: cleanAttributes(i.attributes, restore),
      effectiveDate: typeof i.effective_date === "string" && ISO_DATE.test(i.effective_date) ? i.effective_date : null,
    });
  }
  // One fact per key: the last one wins (the model restating itself).
  const byKey = new Map<string, CandidateFact>();
  for (const f of out) byKey.set(f.key, f);
  return [...byKey.values()];
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Every number in the text, written without spaces or separators ("15 000 €" → "15000"). */
function numbersIn(text: string): string[] {
  return [...fold(text).matchAll(/\d[\d\s.,  ]*\d|\d/g)].map((m) => m[0].replace(/[\s.,  ]/g, "")).filter((n) => n.length > 0);
}

/**
 * A fact the model says the person stated must actually be grounded in the person's message: every
 * number it contains, and the person it names, appear there. Otherwise it is treated as the
 * assistant's claim (and goes to confirmation, never straight into memory).
 */
export function groundedInUserText(fact: Pick<CandidateFact, "content" | "title" | "attributes">, userText: string, replacing = ""): boolean {
  const user = fold(userText);
  // The value being replaced may be named too ("passe à 18 000 € au lieu de 15 000 €"): it is already known.
  const userNumbers = new Set([...numbersIn(userText), ...numbersIn(replacing)]);
  const numbers = [...numbersIn(`${fact.title} ${fact.content}`), ...(fact.attributes.amount !== undefined ? [String(Math.round(fact.attributes.amount))] : [])];
  for (const n of numbers) {
    // Years and dates may be reformatted (12/03/2027 → 2027-03-12): check their parts.
    if (userNumbers.has(n)) continue;
    if ([...userNumbers].some((u) => u.includes(n) || n.includes(u))) continue;
    return false;
  }
  const person = fact.attributes.person;
  if (person) {
    const words = fold(person).split(/\s+/).filter((w) => w.length >= 3);
    if (words.length > 0 && !words.some((w) => user.includes(w))) return false;
  }
  return true;
}

export type FactDecision = "learn" | "confirm" | "private" | "drop";

/**
 * What happens to a candidate: deterministic, explainable rules. `known` are the client's current
 * facts: the value a fact replaces may appear in it without counting as made up.
 */
export function decideFact(fact: CandidateFact, userText: string, known: KnownFact[] = []): FactDecision {
  if (fact.about === "person") return "private";
  if (fact.about !== "client") return "drop";
  const replacing = known.filter((k) => k.key === fact.key).map((k) => `${k.title} ${k.content}`).join(" ");
  if (fact.statedBy !== "user" || fact.confidence < 0.6 || !groundedInUserText(fact, userText, replacing)) return "confirm";
  return "learn";
}

export type KnownFact = { id: string; key: string | null; title: string; content: string; attributes: FactAttributes };

/** Words of three letters or more, numbers left out (they are compared on their own). */
const words = (s: string) => new Set(fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w)));

function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.max(x.size, y.size);
}

const sameNumbers = (a: string, b: string) => numbersIn(a).sort().join("|") === numbersIn(b).sort().join("|");

/** Both facts carry a value (amount, date, person) and the values differ: a change, not a repeat. */
function valuesDiffer(a: FactAttributes, b: FactAttributes): boolean {
  return (["amount", "date", "due", "person"] as const).some(
    (k) => a[k] !== undefined && b[k] !== undefined && String(a[k]).toLowerCase() !== String(b[k]).toLowerCase(),
  );
}

function sameValues(a: FactAttributes, b: FactAttributes): boolean {
  const keys = (["amount", "date", "due", "person"] as const).filter((k) => a[k] !== undefined || b[k] !== undefined);
  return keys.length > 0 && keys.every((k) => String(a[k] ?? "").toLowerCase() === String(b[k] ?? "").toLowerCase());
}

/** The same fact said again: same values, or the same words and the same numbers. */
function sameFact(fact: CandidateFact, k: KnownFact): boolean {
  if (sameValues(fact.attributes, k.attributes)) return true;
  if (valuesDiffer(fact.attributes, k.attributes)) return false;
  const a = `${fact.title} ${fact.content}`;
  const b = `${k.title} ${k.content}`;
  return sameNumbers(fact.content, k.content) && similarity(a, b) >= 0.75;
}

export type WritePlan = { action: "insert" } | { action: "confirm"; existingId: string } | { action: "supersede"; existingId: string };

/**
 * Against what the memory already holds: the same fact again only confirms it (no copy); a new value
 * for the same subject replaces the older one, which stays as history.
 */
export function planWrite(fact: CandidateFact, known: KnownFact[]): WritePlan {
  const sameKey = known.filter((k) => k.key === fact.key);
  for (const k of sameKey) {
    if (sameFact(fact, k)) return { action: "confirm", existingId: k.id };
  }
  if (sameKey.length > 0) return { action: "supersede", existingId: sameKey[0].id };
  const duplicate = known.find((k) => sameNumbers(fact.content, k.content) && similarity(fact.content, k.content) >= 0.85);
  return duplicate ? { action: "confirm", existingId: duplicate.id } : { action: "insert" };
}
