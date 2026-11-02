/**
 * Finds the client a message talks about (CLAUDE.md §11): a client this person can open, named in
 * the text, or a new name introduced as a client ("le client Nike", "pour la société Atlas").
 * Pure and local: nothing leaves the browser.
 */
export type ClientMention = { kind: "link"; id: string; name: string } | { kind: "create"; name: string } | null;

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const INTRO = /\b(?:client|cliente|clients|société|societe|entreprise|marque|compte|account|company|brand|customer)\s+(?:de\s+|d['’]\s*|the\s+)?([A-ZÀ-ÖØ-Þ0-9][\p{L}\p{N}&'’.-]*(?:\s+[A-ZÀ-ÖØ-Þ0-9][\p{L}\p{N}&'’.-]*){0,3})/u;

export function detectClientMention(text: string, clients: readonly { id: string; name: string }[]): ClientMention {
  const t = fold(text);
  if (t.trim().length < 3) return null;
  // Longest names first, so "Nike France" wins over "Nike".
  for (const c of [...clients].sort((a, b) => b.name.length - a.name.length)) {
    const name = fold(c.name.trim());
    if (name.length < 2) continue;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "u").test(t)) return { kind: "link", id: c.id, name: c.name };
  }
  const m = INTRO.exec(text);
  if (!m) return null;
  const name = m[1].replace(/[.,;:!?'’]+$/, "").trim();
  if (name.length < 2 || name.length > 80) return null;
  if (clients.some((c) => fold(c.name) === fold(name))) return null;
  return { kind: "create", name };
}
