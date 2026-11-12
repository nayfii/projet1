import { IMPORT_LIMITS, type ImportedItem, type ImportSource } from "./types";

/**
 * Readers for the export formats of former AI tools. The formats are not documented by the providers;
 * these follow what their exports contain as observed (November 2026) and tolerate the known variants.
 * Only what the PERSON wrote is kept: their messages, their projects' instructions. Assistants' answers
 * and attached files (possibly third parties' documents) are left out.
 */

/** Two 32-bit FNV-1a variants as hex: a short, stable reference. Not a security hash. */
export function shortHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Seconds (ChatGPT), ISO strings (Claude, Takeout) or nothing. */
function isoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const d = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** The person's words, cleaned and cut to the analysed length (the beginning is kept). */
export function clip(text: string): string {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > IMPORT_LIMITS.itemChars ? `${clean.slice(0, IMPORT_LIMITS.itemChars)}…` : clean;
}

function item(source: ImportSource, kind: ImportedItem["kind"], id: string, title: string, date: string | null, text: string): ImportedItem {
  return { ref: shortHash(`${source}:${kind}:${id}`), kind, title: title.trim().slice(0, 200) || "—", date, text: clip(text) };
}

// ─── ChatGPT: conversations.json (or shards conversations-000.json…) ──────────────────────────────

export function looksLikeChatGpt(json: unknown): boolean {
  const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.conversations) ? json.conversations : null;
  return Boolean(list?.some((c) => isRecord(c) && isRecord(c.mapping)));
}

/**
 * Each conversation is a tree of messages (`mapping`): edits and regenerations are branches. The
 * branch the person last saw ends at `current_node`; without it, every message in time order.
 */
export function readChatGpt(json: unknown): { items: ImportedItem[]; skipped: number } {
  const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.conversations) ? json.conversations : [];
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const conv of list) {
    if (!isRecord(conv) || !isRecord(conv.mapping)) {
      skipped++;
      continue;
    }
    const mapping = conv.mapping as Record<string, unknown>;
    const nodes: Record<string, unknown>[] = [];
    const current = str(conv.current_node);
    if (current && isRecord(mapping[current])) {
      const seen = new Set<string>();
      let id: string = current;
      while (id && isRecord(mapping[id]) && !seen.has(id)) {
        seen.add(id);
        const node = mapping[id] as Record<string, unknown>;
        nodes.unshift(node);
        id = str(node.parent);
      }
    } else {
      nodes.push(...Object.values(mapping).filter(isRecord));
      nodes.sort((a, b) => Number((a.message as Record<string, unknown> | null)?.create_time ?? 0) - Number((b.message as Record<string, unknown> | null)?.create_time ?? 0));
    }
    const words: string[] = [];
    for (const node of nodes) {
      const message = node.message;
      if (!isRecord(message) || !isRecord(message.author) || message.author.role !== "user") continue;
      const content = isRecord(message.content) ? message.content : {};
      const parts = Array.isArray(content.parts) ? content.parts.filter((p): p is string => typeof p === "string") : [];
      const text = parts.length ? parts.join("\n") : str(content.text);
      if (text.trim()) words.push(text.trim());
    }
    const text = words.join("\n\n");
    if (text.length < IMPORT_LIMITS.minChars) {
      skipped++;
      continue;
    }
    const id = str(conv.id) || str(conv.conversation_id) || `${str(conv.title)}:${String(conv.create_time)}`;
    items.push(item("chatgpt", "conversation", id, str(conv.title), isoDate(conv.update_time) ?? isoDate(conv.create_time), text));
  }
  return { items, skipped };
}

// ─── Claude: conversations.json (+ projects.json) ─────────────────────────────────────────────────

export function looksLikeClaude(json: unknown): boolean {
  return Array.isArray(json) && json.some((c) => isRecord(c) && (Array.isArray(c.chat_messages) || (Array.isArray(c.messages) && typeof c.uuid === "string")));
}

/** Messages are in `chat_messages` (some exports: `messages`); the person is "human" (or role "user"). */
export function readClaude(json: unknown): { items: ImportedItem[]; skipped: number } {
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const conv of Array.isArray(json) ? json : []) {
    if (!isRecord(conv)) {
      skipped++;
      continue;
    }
    const messages = Array.isArray(conv.chat_messages) ? conv.chat_messages : Array.isArray(conv.messages) ? conv.messages : [];
    const words: string[] = [];
    for (const m of messages) {
      if (!isRecord(m)) continue;
      const who = str(m.sender) || str(m.role);
      if (who !== "human" && who !== "user") continue;
      const blocks = Array.isArray(m.content) ? m.content.filter((b) => isRecord(b) && b.type === "text").map((b) => str((b as Record<string, unknown>).text)) : [];
      const text = str(m.text) || blocks.join("\n");
      if (text.trim()) words.push(text.trim());
    }
    const text = words.join("\n\n");
    if (text.length < IMPORT_LIMITS.minChars) {
      skipped++;
      continue;
    }
    const id = str(conv.uuid) || `${str(conv.name)}:${str(conv.created_at)}`;
    items.push(item("claude", "conversation", id, str(conv.name), isoDate(conv.updated_at) ?? isoDate(conv.created_at), text));
  }
  return { items, skipped };
}

/** A Claude project: its description and instructions (written by the person). Its documents are not read. */
export function readClaudeProjects(json: unknown): { items: ImportedItem[]; skipped: number; documents: number } {
  const items: ImportedItem[] = [];
  let skipped = 0;
  let documents = 0;
  for (const p of Array.isArray(json) ? json : []) {
    if (!isRecord(p)) continue;
    documents += Array.isArray(p.docs) ? p.docs.length : 0;
    const parts = [str(p.description).trim(), str(p.prompt_template).trim()].filter(Boolean);
    const text = parts.join("\n\n");
    if (text.length < IMPORT_LIMITS.minChars) {
      skipped++;
      continue;
    }
    items.push(item("claude", "project", str(p.uuid) || str(p.name), str(p.name), isoDate(p.updated_at) ?? isoDate(p.created_at), text));
  }
  return { items, skipped, documents };
}

// ─── Gemini: Google Takeout "My Activity" (JSON or HTML) ──────────────────────────────────────────

/**
 * Takeout gives one record per prompt ("Prompted …" in English, a translated label otherwise), no
 * conversations: the prompts of one day are read together.
 */
const PROMPT_LABEL = /^(?:prompted|asked|you asked|requête|vous avez demandé|demande|gefragt|prompt)\s*:?\s*/i;

export function looksLikeGeminiActivity(json: unknown): boolean {
  return Array.isArray(json) && json.some((r) => isRecord(r) && (/gemini|bard/i.test(str(r.header)) || (Array.isArray(r.products) && r.products.some((p) => /gemini|bard/i.test(str(p))))));
}

function byDay(records: { prompt: string; date: string | null }[]): { items: ImportedItem[]; skipped: number } {
  const days = new Map<string, { prompts: string[]; date: string | null }>();
  let skipped = 0;
  for (const r of records) {
    const prompt = r.prompt.replace(PROMPT_LABEL, "").trim();
    if (!prompt) {
      skipped++;
      continue;
    }
    const day = r.date?.slice(0, 10) ?? "undated";
    const entry = days.get(day) ?? { prompts: [], date: r.date };
    entry.prompts.push(prompt);
    days.set(day, entry);
  }
  const items: ImportedItem[] = [];
  for (const [day, { prompts, date }] of days) {
    const text = prompts.reverse().join("\n\n");
    if (text.length < IMPORT_LIMITS.minChars) {
      skipped += prompts.length;
      continue;
    }
    items.push(item("gemini", "conversation", day, `Gemini — ${day === "undated" ? "?" : day}`, date, text));
  }
  return { items, skipped };
}

export function readGeminiActivity(json: unknown): { items: ImportedItem[]; skipped: number } {
  const records = (Array.isArray(json) ? json : [])
    .filter((r): r is Record<string, unknown> => isRecord(r) && (/gemini|bard/i.test(str(r.header)) || (Array.isArray(r.products) && r.products.some((p) => /gemini|bard/i.test(str(p))))))
    .map((r) => ({ prompt: str(r.title), date: isoDate(r.time) }));
  return byDay(records);
}

/** The HTML variant: one "outer-cell" per record; its first text is the prompt, a line holds the date. */
export function readGeminiActivityHtml(html: string): { items: ImportedItem[]; skipped: number } {
  const records: { prompt: string; date: string | null }[] = [];
  for (const cell of html.split(/class="outer-cell/).slice(1)) {
    const content = /class="content-cell[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(cell)?.[1] ?? "";
    const lines = htmlToText(content.replace(/<br\s*\/?>/gi, "\n"))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const dateLine = lines.find((l) => /\d{4}/.test(l) && !Number.isNaN(Date.parse(l.replace(/\s+[A-Z]{2,5}$/, ""))));
    records.push({ prompt: lines.filter((l) => l !== dateLine).join("\n"), date: dateLine ? isoDate(dateLine.replace(/\s+[A-Z]{2,5}$/, "")) : null });
  }
  return byDay(records);
}

// ─── Files: Markdown, text, HTML, CSV (Perplexity's thread exports, notes…) ────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Visible text of an HTML document (scripts and styles removed). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#") && e !== "#39") return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function looksLikePerplexity(name: string, text: string): boolean {
  return /perplexity/i.test(name) || /perplexity\.ai/i.test(text.slice(0, 20_000));
}

/** A text file as one item: its first heading (or the file name) is the title. */
export function readTextFile(source: ImportSource, name: string, raw: string, kind: "md" | "txt" | "html" | "csv"): { items: ImportedItem[]; skipped: number } {
  const text = kind === "html" ? htmlToText(raw) : raw;
  if (text.trim().length < IMPORT_LIMITS.minChars) return { items: [], skipped: 1 };
  const heading = kind === "md" ? /^#{1,3}\s+(.+)$/m.exec(text)?.[1] : null;
  const title = heading ?? name.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "");
  return { items: [item(source, "document", `${name}:${text.length}:${shortHash(text.slice(0, 2000))}`, title, null, text)], skipped: 0 };
}

/** Which reader a JSON file needs, from its content. */
export function detectJson(json: unknown): ImportSource | null {
  if (looksLikeChatGpt(json)) return "chatgpt";
  if (looksLikeClaude(json)) return "claude";
  if (looksLikeGeminiActivity(json)) return "gemini";
  return null;
}
