/**
 * Light formatting inside a block's text, written as marks the person never has to type: the
 * floating toolbar adds them around a selection. **bold**, *italic*, [label](https://…) and
 * [[doc:<id>]] (a link to another document, shown with its current title).
 */

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "doc"; id: string };

const TOKEN = /\[\[doc:([0-9a-f-]{36})\]\]|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseInline(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    if (m[1]) out.push({ kind: "doc", id: m[1] });
    else if (m[2]) out.push({ kind: "bold", text: m[2] });
    else if (m[3]) out.push({ kind: "italic", text: m[3] });
    else if (m[4] && m[5]) out.push({ kind: "link", text: m[4], url: m[5] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** True when the text holds any mark (otherwise it is shown as typed). */
export function hasMarks(text: string): boolean {
  return new RegExp(TOKEN.source).test(text);
}

export type Wrap = "bold" | "italic" | "link";

/**
 * The selection [start, end) wrapped in a mark (or unwrapped when it already is). Returns the new
 * text and where the selection now is.
 */
export function wrapSelection(text: string, start: number, end: number, mark: Wrap, url = ""): { text: string; start: number; end: number } {
  const selected = text.slice(start, end);
  if (mark === "link") {
    const label = selected || url;
    const inserted = `[${label}](${url})`;
    return { text: text.slice(0, start) + inserted + text.slice(end), start: start + 1, end: start + 1 + label.length };
  }
  const tag = mark === "bold" ? "**" : "*";
  // Already wrapped: the marks just outside the selection go away.
  if (text.slice(start - tag.length, start) === tag && text.slice(end, end + tag.length) === tag && (mark === "bold" || text.slice(start - 2, start) !== "**")) {
    return { text: text.slice(0, start - tag.length) + selected + text.slice(end + tag.length), start: start - tag.length, end: end - tag.length };
  }
  return { text: text.slice(0, start) + tag + selected + tag + text.slice(end), start: start + tag.length, end: end + tag.length };
}

/** A link to a document, as written in the text. */
export const docToken = (id: string) => `[[doc:${id}]]`;
