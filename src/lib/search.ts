/** Lowercase, without accents or extra spaces: "Éloïse  Dupré" → "eloise dupre". */
export function searchKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Whether every word typed appears in one of the fields (first name, last name, e-mail…), ignoring
 * case and accents: "elo dup", "Dupre" and "eloise@" all find "Éloïse Dupré <eloise@…>".
 */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.filter(Boolean).map((f) => searchKey(f!)).join(" ");
  return words.every((w) => haystack.includes(w));
}
