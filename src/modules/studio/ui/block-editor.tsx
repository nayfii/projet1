"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoldIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GripVerticalIcon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  LightbulbIcon,
  LinkIcon,
  ListChecksIcon,
  ListCollapseIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderCircleIcon,
  MessageSquareQuoteIcon,
  MinusIcon,
  PilcrowIcon,
  PlusIcon,
  QuoteIcon,
  ScaleIcon,
  SearchCheckIcon,
  TableIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { block, MENU_TYPES, newBlockId, type Block, type BlockType } from "../logic/blocks";
import { docToken, hasMarks, parseInline, wrapSelection, type Wrap } from "../logic/inline";
import { rank } from "../logic/search";
import * as server from "../server/actions";
import { DocumentPicker } from "./pickers";
import { useStudio } from "./store";

const ICON: Record<BlockType, React.ComponentType<{ className?: string }>> = {
  h2: Heading2Icon,
  h3: Heading3Icon,
  p: PilcrowIcon,
  bullet: ListIcon,
  numbered: ListOrderedIcon,
  check: ListChecksIcon,
  toggle: ListCollapseIcon,
  quote: QuoteIcon,
  callout: MessageSquareQuoteIcon,
  image: ImageIcon,
  table: TableIcon,
  link: LinkIcon,
  divider: MinusIcon,
  hypothesis: LightbulbIcon,
  fact: SearchCheckIcon,
  decision: ScaleIcon,
};

/** Text blocks: they take formatting, links to documents and the "/" menu. */
const TEXT_TYPES: BlockType[] = ["h2", "h3", "p", "bullet", "numbered", "check", "toggle", "quote", "callout", "hypothesis", "fact", "decision"];
const SHORTCUTS: [RegExp, BlockType][] = [
  [/^###$/, "h3"],
  [/^##$/, "h2"],
  [/^#$/, "h2"],
  [/^[-*]$/, "bullet"],
  [/^1[.)]$/, "numbered"],
  [/^\[ ?\]$/, "check"],
  [/^>$/, "quote"],
];
const CONTINUES: BlockType[] = ["bullet", "numbered", "check"];
const DOC_LINK = "doclink" as const;
type MenuChoice = BlockType | typeof DOC_LINK;

export const imageUrl = (path: string) => `/api/studio/image?path=${encodeURIComponent(path)}`;

/**
 * The block editor: type, press Enter for a new block, "/" for the menu, "[[" to link a document.
 * Select text to make it bold, italic or a link (⌘B, ⌘I, ⌘K). Text with formatting is shown formatted
 * when the cursor is elsewhere.
 */
export function BlockEditor({ documentId, blocks, onChange }: { documentId: string; blocks: Block[]; onChange: (b: Block[]) => void }) {
  const t = useTranslations("studio.editor");
  const data = useStudio();
  const refs = React.useRef(new Map<string, HTMLTextAreaElement>());
  const [slash, setSlash] = React.useState<{ id: string; active: number } | null>(null);
  const [mention, setMention] = React.useState<{ id: string; start: number; query: string; active: number } | null>(null);
  const [focused, setFocused] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<{ id: string; start: number; end: number } | null>(null);
  const [picker, setPicker] = React.useState<{ id: string; at: number } | null>(null);
  const [drag, setDrag] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const imageTarget = React.useRef<string | null>(null);
  const pendingFocus = React.useRef<{ id: string; at: number | "end"; end?: number } | null>(null);
  const titles = React.useMemo(() => new Map(data.documents.map((d) => [d.id, d.title])), [data.documents]);

  React.useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    const el = refs.current.get(f.id);
    if (el) {
      el.focus();
      const pos = f.at === "end" ? el.value.length : f.at;
      el.setSelectionRange(pos, f.end ?? pos);
    }
    pendingFocus.current = null;
  });

  const update = (id: string, patch: Partial<Block>) => onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const insertAfter = (id: string, b: Block) => {
    const i = blocks.findIndex((x) => x.id === id);
    onChange([...blocks.slice(0, i + 1), b, ...blocks.slice(i + 1)]);
    pendingFocus.current = { id: b.id, at: 0 };
  };
  const remove = (id: string, focusPrev = true) => {
    const i = blocks.findIndex((x) => x.id === id);
    const next = blocks.filter((x) => x.id !== id);
    onChange(next.length ? next : [block("p")]);
    const prev = next[i - 1] ?? next[0];
    if (focusPrev && prev) pendingFocus.current = { id: prev.id, at: "end" };
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  async function upload(id: string, file: File) {
    setUploading(id);
    const form = new FormData();
    form.append("document_id", documentId);
    form.append("file", file);
    const res = await server.uploadImage(form).catch(() => null);
    setUploading(null);
    if (!res?.ok) return toast.error(t("imageFailed"));
    onChange(blocksRef.current.map((b) => (b.id === id ? { ...b, type: "image", path: res.data.path } : b)));
  }
  // The latest blocks, for changes that finish after an upload.
  const blocksRef = React.useRef(blocks);
  React.useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const turnInto = (id: string, type: MenuChoice) => {
    const b = blocks.find((x) => x.id === id);
    if (!b) return;
    setSlash(null);
    const text = b.text.startsWith("/") ? "" : b.text;
    if (type === DOC_LINK) {
      update(id, { text });
      setPicker({ id, at: text.length });
      return;
    }
    const patch: Partial<Block> = { type, text };
    if (type === "table" && !b.rows) patch.rows = [["", ""], ["", ""]];
    if (type === "check") patch.checked = false;
    if (type === "link") patch.url = b.url ?? "";
    if (type === "toggle") patch.open = true;
    update(id, patch);
    if (type === "image") {
      imageTarget.current = id;
      fileInput.current?.click();
      return;
    }
    if (TEXT_TYPES.includes(type)) pendingFocus.current = { id, at: "end" };
  };

  const menuOptions = (b: Block): MenuChoice[] => {
    const q = b.text.slice(1).toLocaleLowerCase();
    const all: MenuChoice[] = [...MENU_TYPES.slice(0, 11), DOC_LINK, ...MENU_TYPES.slice(11)];
    return all.filter((type) => !q || t(`types.${type}`).toLocaleLowerCase().includes(q));
  };

  const mentionOptions = mention ? rank(mention.query || " ", data.documents.filter((d) => !d.archived_at && d.id !== documentId), (d) => [d.title]).map((r) => r.item).slice(0, 8) : [];
  const mentionList = mention && !mention.query ? data.documents.filter((d) => !d.archived_at && d.id !== documentId).slice(0, 8) : mentionOptions;

  function applyWrap(b: Block, mark: Wrap) {
    const el = refs.current.get(b.id);
    if (!el) return;
    let url = "";
    if (mark === "link") {
      url = window.prompt(t("linkPrompt"), "https://")?.trim() ?? "";
      if (!/^https?:\/\/\S+$/i.test(url)) return;
    }
    const res = wrapSelection(b.text, el.selectionStart, el.selectionEnd, mark, url);
    update(b.id, { text: res.text });
    pendingFocus.current = { id: b.id, at: res.start, end: res.end };
  }

  function insertDocLink(blockId: string, from: number, to: number, docId: string) {
    const b = blocks.find((x) => x.id === blockId);
    if (!b) return;
    const token = docToken(docId);
    const text = b.text.slice(0, from) + token + b.text.slice(to);
    update(blockId, { text });
    setMention(null);
    pendingFocus.current = { id: blockId, at: from + token.length };
  }

  // Numbered lists restart after any other kind of block.
  const numbers = blocks.reduce<number[]>((acc, b, i) => [...acc, b.type === "numbered" ? (acc[i - 1] ?? 0) + 1 : 0], []);
  return (
    <div className="mt-4 space-y-0.5 pb-24">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const id = imageTarget.current;
          e.target.value = "";
          if (file && id) void upload(id, file);
        }}
      />
      {blocks.map((b, i) => {
        const options = slash?.id === b.id ? menuOptions(b) : [];
        const isText = TEXT_TYPES.includes(b.type);
        const hasSelection = selection?.id === b.id && selection.start !== selection.end && focused === b.id;
        return (
          <div
            key={b.id}
            onDragOver={(e) => drag && drag !== b.id && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!drag || drag === b.id) return;
              const from = blocks.findIndex((x) => x.id === drag);
              const next = blocks.filter((x) => x.id !== drag);
              const to = next.findIndex((x) => x.id === b.id);
              next.splice(to + (from < i ? 1 : 0), 0, blocks[from]);
              onChange(next);
              setDrag(null);
            }}
            className={cn("group/block relative -ml-14 flex items-start gap-1 pl-14", drag === b.id && "opacity-40")}
          >
            <div className="absolute left-0 top-1 flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/block:opacity-100">
              <button type="button" aria-label={t("addBelow")} onClick={() => insertAfter(b.id, block("p"))} className="rounded p-1 text-muted-foreground hover:bg-accent">
                <PlusIcon className="size-4" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t("blockMenu")}
                  draggable
                  onDragStart={(e) => {
                    setDrag(b.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDrag(null)}
                  className="cursor-grab rounded p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <GripVerticalIcon className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("turnInto")}</DropdownMenuLabel>
                  {MENU_TYPES.map((type) => {
                    const Icon = ICON[type];
                    return (
                      <DropdownMenuItem key={type} onSelect={() => turnInto(b.id, type)}>
                        <Icon />
                        {t(`types.${type}`)}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => move(b.id, -1)} disabled={i === 0}>
                    <ArrowUpIcon />
                    {t("moveUp")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => move(b.id, 1)} disabled={i === blocks.length - 1}>
                    <ArrowDownIcon />
                    {t("moveDown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => insertAfter(b.id, { ...b, id: newBlockId(), rows: b.rows?.map((r) => [...r]), path: undefined, type: b.type === "image" ? "p" : b.type })}>
                    <CopyIcon />
                    {t("duplicateBlock")}
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={() => remove(b.id, false)}>
                    <Trash2Icon />
                    {t("deleteBlock")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="relative min-w-0 flex-1">
              {hasSelection ? (
                <div role="toolbar" aria-label={t("format")} className="absolute -top-9 right-0 z-30 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 shadow-md animate-message-in">
                  {(
                    [
                      ["bold", BoldIcon, "⌘B"],
                      ["italic", ItalicIcon, "⌘I"],
                      ["link", LinkIcon, "⌘K"],
                    ] as const
                  ).map(([mark, Icon, keys]) => (
                    <button key={mark} type="button" title={`${t(`marks.${mark}`)} (${keys})`} aria-label={t(`marks.${mark}`)} onMouseDown={(e) => e.preventDefault()} onClick={() => applyWrap(b, mark)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                      <Icon className="size-3.5" />
                    </button>
                  ))}
                  <button
                    type="button"
                    title={t("types.doclink")}
                    aria-label={t("types.doclink")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setPicker({ id: b.id, at: selection!.end })}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <FileTextIcon className="size-3.5" />
                  </button>
                </div>
              ) : null}
              <BlockBody
                b={b}
                number={numbers[i]}
                titles={titles}
                editing={focused === b.id}
                uploading={uploading === b.id}
                inputRef={(el) => {
                  if (el) refs.current.set(b.id, el);
                  else refs.current.delete(b.id);
                }}
                onPatch={(patch) => update(b.id, patch)}
                onFocusChange={(on) => {
                  setFocused((f) => (on ? b.id : f === b.id ? null : f));
                  if (!on) {
                    setSelection((s) => (s?.id === b.id ? null : s));
                    setTimeout(() => setMention((m) => (m?.id === b.id ? null : m)), 150);
                  }
                }}
                onSelectText={(start, end) => setSelection({ id: b.id, start, end })}
                onPickImage={() => {
                  imageTarget.current = b.id;
                  fileInput.current?.click();
                }}
                onPasteImage={(file) => {
                  const created = block("image", "");
                  insertAfter(b.id, created);
                  void upload(created.id, file);
                }}
                onText={(text, caret) => {
                  if (isText && text.startsWith("/") && !b.text.startsWith("/")) setSlash({ id: b.id, active: 0 });
                  if (!text.startsWith("/") && slash?.id === b.id) setSlash(null);
                  const before = text.slice(0, caret);
                  const m = /\[\[([^\]\n]{0,40})$/.exec(before);
                  if (isText && m) setMention({ id: b.id, start: caret - m[0].length, query: m[1], active: mention?.id === b.id ? mention.active : 0 });
                  else if (mention?.id === b.id) setMention(null);
                  update(b.id, { text });
                }}
                onKeyDown={(e, el) => {
                  const mod = e.metaKey || e.ctrlKey;
                  if (mod && isText && el.selectionStart !== el.selectionEnd && ["b", "i", "k"].includes(e.key.toLowerCase())) {
                    e.preventDefault();
                    applyWrap(b, e.key.toLowerCase() === "b" ? "bold" : e.key.toLowerCase() === "i" ? "italic" : "link");
                    return;
                  }
                  if (mention?.id === b.id && mentionList.length) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setMention({ ...mention, active: (mention.active + (e.key === "ArrowDown" ? 1 : -1) + mentionList.length) % mentionList.length });
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      insertDocLink(b.id, mention.start, el.selectionStart, mentionList[Math.min(mention.active, mentionList.length - 1)].id);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setMention(null);
                      return;
                    }
                  }
                  if (slash?.id === b.id && options.length) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlash({ id: b.id, active: (slash.active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length });
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      turnInto(b.id, options[Math.min(slash.active, options.length - 1)]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setSlash(null);
                      return;
                    }
                  }
                  const pos = el.selectionStart ?? 0;
                  const atEnd = pos === el.value.length && el.selectionEnd === pos;
                  if (e.key === " " && pos === b.text.length && b.type === "p") {
                    const match = SHORTCUTS.find(([re]) => re.test(b.text));
                    if (match) {
                      e.preventDefault();
                      update(b.id, { type: match[1], text: "", ...(match[1] === "check" ? { checked: false } : {}) });
                      return;
                    }
                    if (b.text === "---") {
                      e.preventDefault();
                      update(b.id, { type: "divider", text: "" });
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (CONTINUES.includes(b.type) && !b.text) {
                      update(b.id, { type: "p" });
                      return;
                    }
                    const rest = atEnd ? "" : el.value.slice(pos);
                    const nextType: BlockType = CONTINUES.includes(b.type) ? b.type : "p";
                    const created = block(nextType, rest, nextType === "check" ? { checked: false } : {});
                    const idx = blocks.findIndex((x) => x.id === b.id);
                    const next = [...blocks];
                    next[idx] = { ...b, text: el.value.slice(0, pos) };
                    next.splice(idx + 1, 0, created);
                    onChange(next);
                    pendingFocus.current = { id: created.id, at: 0 };
                    return;
                  }
                  if (e.key === "Backspace" && pos === 0 && el.selectionEnd === 0) {
                    if (b.type !== "p" && isText) {
                      e.preventDefault();
                      update(b.id, { type: "p" });
                      return;
                    }
                    const prev = blocks[i - 1];
                    if (!prev) return;
                    e.preventDefault();
                    if (!b.text) remove(b.id);
                    else if (TEXT_TYPES.includes(prev.type)) {
                      const joinAt = prev.text.length;
                      onChange(blocks.filter((x) => x.id !== b.id).map((x) => (x.id === prev.id ? { ...x, text: x.text + b.text } : x)));
                      pendingFocus.current = { id: prev.id, at: joinAt };
                    }
                    return;
                  }
                  if (e.key === "ArrowUp" && pos === 0 && i > 0 && refs.current.get(blocks[i - 1].id)) {
                    e.preventDefault();
                    pendingFocus.current = { id: blocks[i - 1].id, at: "end" };
                    onChange([...blocks]);
                  }
                  if (e.key === "ArrowDown" && atEnd && i < blocks.length - 1 && refs.current.get(blocks[i + 1].id)) {
                    e.preventDefault();
                    pendingFocus.current = { id: blocks[i + 1].id, at: 0 };
                    onChange([...blocks]);
                  }
                }}
              />
              {slash?.id === b.id ? (
                <div role="listbox" aria-label={t("turnInto")} className="absolute left-0 top-full z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
                  {options.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">{t("noType")}</p> : null}
                  {options.map((type, k) => {
                    const Icon = type === DOC_LINK ? FileTextIcon : ICON[type];
                    return (
                      <button
                        key={type}
                        type="button"
                        role="option"
                        aria-selected={k === slash.active}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => turnInto(b.id, type)}
                        className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", k === slash.active ? "bg-accent" : "hover:bg-accent/60")}
                      >
                        <Icon className="size-4 text-muted-foreground" />
                        {t(`types.${type}`)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {mention?.id === b.id ? (
                <div role="listbox" aria-label={t("types.doclink")} className="absolute left-0 top-full z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
                  <p className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">{t("linkToDocument")}</p>
                  {mentionList.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">{t("noDocument")}</p> : null}
                  {mentionList.map((d, k) => (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={k === mention.active}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertDocLink(b.id, mention.start, mention.start + 2 + mention.query.length, d.id)}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", k === mention.active ? "bg-accent" : "hover:bg-accent/60")}
                    >
                      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{d.title}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...blocks, block("p")])} className="mt-2 flex w-full items-center gap-2 rounded-md px-1 py-2 text-left text-sm text-muted-foreground/70 hover:text-muted-foreground">
        <PlusIcon className="size-4" />
        {t("addBlock")}
      </button>
      {picker ? (
        <DocumentPicker
          exclude={[documentId]}
          onClose={() => setPicker(null)}
          onPick={(docId) => {
            const p = picker;
            setPicker(null);
            insertDocLink(p.id, p.at, p.at, docId);
          }}
        />
      ) : null}
    </div>
  );
}

/** Text with its formatting: bold, italic, links (new tab) and links to documents (current title). */
export function InlineText({ text, titles, className }: { text: string; titles: Map<string, string>; className?: string }) {
  const t = useTranslations("studio.editor");
  return (
    <span className={className}>
      {parseInline(text).map((s, i) => {
        if (s.kind === "bold") return <strong key={i} className="font-semibold">{s.text}</strong>;
        if (s.kind === "italic") return <em key={i}>{s.text}</em>;
        if (s.kind === "link")
          return (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.stopPropagation()} className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground">
              {s.text}
            </a>
          );
        if (s.kind === "doc") {
          const title = titles.get(s.id);
          return title ? (
            <Link key={i} href={`/studio/knowledge/${s.id}`} onMouseDown={(e) => e.stopPropagation()} className="inline-flex items-baseline gap-1 rounded bg-muted px-1 font-medium decoration-muted-foreground/50 underline-offset-2 hover:underline">
              <FileTextIcon className="size-3.5 self-center text-muted-foreground" />
              {title}
            </Link>
          ) : (
            <span key={i} className="rounded bg-muted px-1 text-muted-foreground line-through">
              {t("missingDocument")}
            </span>
          );
        }
        return <React.Fragment key={i}>{s.text}</React.Fragment>;
      })}
    </span>
  );
}

function BlockBody({
  b,
  number,
  titles,
  editing,
  uploading,
  inputRef,
  onText,
  onPatch,
  onKeyDown,
  onFocusChange,
  onSelectText,
  onPickImage,
  onPasteImage,
}: {
  b: Block;
  number: number;
  titles: Map<string, string>;
  editing: boolean;
  uploading: boolean;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  onText: (text: string, caret: number) => void;
  onPatch: (patch: Partial<Block>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, el: HTMLTextAreaElement) => void;
  onFocusChange: (on: boolean) => void;
  onSelectText: (start: number, end: number) => void;
  onPickImage: () => void;
  onPasteImage: (file: File) => void;
}) {
  const t = useTranslations("studio.editor");
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const text = (className: string, placeholder?: string) => {
    // Formatting shows when the cursor is elsewhere; a click puts the cursor back in the text.
    const formatted = !editing && hasMarks(b.text);
    return (
      <div className="relative min-w-0 flex-1">
        <AutoArea
          ref={(el) => {
            areaRef.current = el;
            inputRef(el);
          }}
          value={b.text}
          rows={1}
          onChange={(e) => onText(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => onKeyDown(e, e.currentTarget)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onSelect={(e) => onSelectText(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
          onPaste={(e) => {
            const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (!file) return;
            e.preventDefault();
            onPasteImage(file);
          }}
          placeholder={b.hint ?? placeholder ?? t("placeholder")}
          aria-label={t(`types.${b.type}`)}
          className={cn("block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/45", formatted && "text-transparent caret-transparent", className)}
        />
        {formatted ? (
          <div data-formatted onMouseDown={(e) => {
              e.preventDefault();
              areaRef.current?.focus();
            }} className={cn("absolute inset-0 cursor-text whitespace-pre-wrap break-words", className)}>
            <InlineText text={b.text} titles={titles} />
          </div>
        ) : null}
      </div>
    );
  };

  switch (b.type) {
    case "h2":
      return text("mt-6 text-[22px] font-semibold leading-snug tracking-tight", t("types.h2"));
    case "h3":
      return text("mt-4 text-[17px] font-semibold leading-snug", t("types.h3"));
    case "bullet":
      return (
        <div className="flex gap-2 py-0.5">
          <span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-foreground/70" />
          {text("text-[15px] leading-relaxed")}
        </div>
      );
    case "numbered":
      return (
        <div className="flex gap-2 py-0.5">
          <span aria-hidden className="w-5 shrink-0 pt-px text-right text-[15px] tabular-nums text-muted-foreground">{`${number}.`}</span>
          {text("text-[15px] leading-relaxed")}
        </div>
      );
    case "check":
      return (
        <div className="flex items-start gap-2 py-0.5">
          <Checkbox checked={Boolean(b.checked)} onCheckedChange={(c) => onPatch({ checked: Boolean(c) })} aria-label={t("toggleCheck")} className="mt-1" />
          {text(cn("text-[15px] leading-relaxed", b.checked && "text-muted-foreground line-through"))}
        </div>
      );
    case "toggle":
      return (
        <div className="py-0.5">
          <div className="flex items-start gap-1">
            <button type="button" aria-expanded={b.open !== false} aria-label={b.open === false ? t("expand") : t("collapse")} onClick={() => onPatch({ open: b.open === false })} className="mt-1 rounded p-0.5 text-muted-foreground hover:bg-accent">
              <ChevronRightIcon className={cn("size-4 transition-transform", b.open !== false && "rotate-90")} />
            </button>
            {text("text-[15px] font-medium leading-relaxed", t("toggleSummary"))}
          </div>
          {b.open !== false ? (
            <div className="ml-6 border-l pl-3">
              <AutoArea value={b.body ?? ""} rows={1} onChange={(e) => onPatch({ body: e.target.value })} placeholder={t("toggleBody")} aria-label={t("toggleBody")} maxLength={20000} className="block w-full resize-none overflow-hidden bg-transparent py-0.5 text-[15px] leading-relaxed text-foreground/90 outline-none placeholder:text-muted-foreground/45" />
            </div>
          ) : null}
        </div>
      );
    case "callout":
      return (
        <div className="my-2 flex gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5">
          <LightbulbIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
          {text("text-[15px] leading-relaxed")}
        </div>
      );
    case "hypothesis":
    case "fact":
    case "decision":
      return (
        <div className={cn("my-2 rounded-r-lg border-l-[3px] px-3 py-2", b.type === "hypothesis" ? "border-warning bg-warning-soft/40" : b.type === "fact" ? "border-success bg-success-soft/40" : "border-foreground bg-muted/60")}>
          <p className={cn("text-[11px] font-semibold uppercase tracking-wider", b.type === "hypothesis" ? "text-warning" : b.type === "fact" ? "text-success" : "text-foreground")}>{t(`kinds.${b.type}`)}</p>
          {text("text-[15px] leading-relaxed")}
        </div>
      );
    case "quote":
      return <div className="my-1 flex border-l-2 border-muted-foreground/40 pl-3">{text("text-[15px] italic leading-relaxed text-foreground/85")}</div>;
    case "divider":
      return <hr className="my-4 border-border" />;
    case "image":
      return (
        <figure className="my-3">
          {b.path ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private file behind a short signed link
            <img src={imageUrl(b.path)} alt={b.text || t("imageAlt")} className="max-h-[32rem] w-auto max-w-full rounded-lg border" />
          ) : (
            <button type="button" onClick={onPickImage} disabled={uploading} className="flex h-28 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-accent/40">
              {uploading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
              {uploading ? t("uploading") : t("chooseImage")}
            </button>
          )}
          <input value={b.text} onChange={(e) => onPatch({ text: e.target.value })} placeholder={t("caption")} aria-label={t("caption")} maxLength={500} className="mt-1.5 w-full bg-transparent text-center text-[13px] text-muted-foreground outline-none placeholder:text-muted-foreground/50" />
        </figure>
      );
    case "link":
      return (
        <div className="my-1 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <LinkIcon className="size-4 text-muted-foreground" />
          <input value={b.text} onChange={(e) => onPatch({ text: e.target.value })} placeholder={t("linkLabel")} aria-label={t("linkLabel")} maxLength={500} className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none" />
          <input value={b.url ?? ""} onChange={(e) => onPatch({ url: e.target.value })} placeholder={b.hint ?? "https://…"} aria-label={t("linkUrl")} maxLength={2000} className="min-w-[10rem] flex-[2] bg-transparent text-sm text-muted-foreground outline-none" />
          {b.url && /^https?:\/\//.test(b.url) ? (
            <a href={b.url} target="_blank" rel="noopener noreferrer" aria-label={t("openLink")} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <ExternalLinkIcon className="size-4" />
            </a>
          ) : null}
        </div>
      );
    case "table":
      return <TableBlock rows={b.rows ?? [["", ""]]} onRows={(rows) => onPatch({ rows })} />;
    default:
      return text("py-0.5 text-[15px] leading-relaxed");
  }
}

/** A textarea that grows with its text (every browser). */
export function AutoArea({ ref, ...props }: React.ComponentProps<"textarea">) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  React.useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return (
    <textarea
      {...props}
      ref={(el) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
    />
  );
}

function TableBlock({ rows, onRows }: { rows: string[][]; onRows: (rows: string[][]) => void }) {
  const t = useTranslations("studio.editor");
  const width = Math.max(1, ...rows.map((r) => r.length));
  const set = (ri: number, ci: number, v: string) => onRows(rows.map((r, i) => (i === ri ? Array.from({ length: width }, (_, k) => (k === ci ? v : (r[k] ?? ""))) : r)));
  return (
    <div className="my-2">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className={cn(ri === 0 ? "bg-muted/50 font-medium" : "border-t")}>
                {Array.from({ length: width }, (_, ci) => (
                  <td key={ci} className="min-w-[7rem] border-r p-0 last:border-r-0">
                    <input value={r[ci] ?? ""} onChange={(e) => set(ri, ci, e.target.value)} aria-label={t("cell", { row: ri + 1, col: ci + 1 })} maxLength={2000} className="w-full bg-transparent px-2 py-1.5 outline-none focus:bg-accent/50" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs">
        <button type="button" disabled={rows.length >= 60} onClick={() => onRows([...rows, Array(width).fill("")])} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          {t("addRow")}
        </button>
        <button type="button" disabled={width >= 12} onClick={() => onRows(rows.map((r) => [...r, ""]))} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          {t("addColumn")}
        </button>
        {rows.length > 1 ? (
          <button type="button" onClick={() => onRows(rows.slice(0, -1))} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            {t("removeRow")}
          </button>
        ) : null}
        {width > 1 ? (
          <button type="button" onClick={() => onRows(rows.map((r) => r.slice(0, width - 1)))} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            {t("removeColumn")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
