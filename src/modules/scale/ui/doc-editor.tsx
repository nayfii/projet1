"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  Heading2Icon,
  Heading3Icon,
  LightbulbIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderCircleIcon,
  MinusIcon,
  PilcrowIcon,
  PlusIcon,
  QuoteIcon,
  ScaleIcon,
  SearchCheckIcon,
  TableIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { block, BLOCK_TYPES, newBlockId, type Block, type BlockType } from "../logic/blocks";
import * as server from "../server/actions";
import type { ScaleDocument } from "../types";
import { EntityExtras } from "./details";
import { RecordMenu } from "./primitives";
import { useIndex } from "./selectors";
import { useScaleActions } from "./store";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const ICON: Record<BlockType, React.ComponentType<{ className?: string }>> = {
  h2: Heading2Icon,
  h3: Heading3Icon,
  p: PilcrowIcon,
  bullet: ListIcon,
  numbered: ListOrderedIcon,
  check: ListChecksIcon,
  hypothesis: LightbulbIcon,
  fact: SearchCheckIcon,
  decision: ScaleIcon,
  quote: QuoteIcon,
  table: TableIcon,
  link: LinkIcon,
  divider: MinusIcon,
};

const draftKey = (id: string) => `cendr-scale:doc-draft:${id}`;

/** A Scale document: blocks, saved automatically, never overwriting someone else's newer version. */
export function DocEditor({ id }: { id: string }) {
  const t = useTranslations("scale.doc");
  const actions = useScaleActions();
  const index = useIndex();
  const router = useRouter();
  const [doc, setDoc] = React.useState<ScaleDocument | null>(null);
  const [failed, setFailed] = React.useState<null | "not_found" | "error">(null);
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [title, setTitle] = React.useState("");
  const [state, setState] = React.useState<SaveState>("saved");
  const [conflict, setConflict] = React.useState<ScaleDocument | null>(null);
  const [draft, setDraft] = React.useState<{ title: string; blocks: Block[] } | null>(null);
  const version = React.useRef<string>("");
  const conflictRef = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef({ title: "", blocks: [] as Block[] });

  const load = React.useCallback(async () => {
    setFailed(null);
    const res = await server.getDocument(id).catch(() => null);
    if (!res?.ok) {
      setFailed(res && !res.ok && res.error === "not_found" ? "not_found" : "error");
      return;
    }
    const d = res.data;
    setDoc(d);
    setTitle(d.title);
    const content = (d.content as unknown as Block[]) ?? [];
    setBlocks(content.length ? content : [block("p")]);
    version.current = d.updated_at;
    latest.current = { title: d.title, blocks: content };
    setState("saved");
    try {
      const raw = localStorage.getItem(draftKey(id));
      if (raw) {
        const saved = JSON.parse(raw) as { base: string; title: string; blocks: Block[] };
        if (JSON.stringify(saved.blocks) !== JSON.stringify(content) || saved.title !== d.title) setDraft({ title: saved.title, blocks: saved.blocks });
        else localStorage.removeItem(draftKey(id));
      }
    } catch {
      // No draft kept in this browser.
    }
  }, [id]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the document is read when the page opens
    void load();
  }, [load]);

  const save = React.useCallback(
    async (force?: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const { title: tt, blocks: bb } = latest.current;
      if (!tt.trim()) return;
      setState("saving");
      const res = await server.saveDocument(id, { title: tt.trim(), content: bb }, force ?? version.current).catch(() => null);
      if (res?.ok) {
        version.current = res.data.updated_at;
        setState((s) => (s === "saving" ? "saved" : s));
        setConflict(null);
        const { content: _content, ...meta } = res.data;
        void _content;
        actions.local("document", meta as unknown as { id: string } & Record<string, unknown>);
        try {
          localStorage.removeItem(draftKey(id));
        } catch {
          // Nothing to clear.
        }
      } else if (res && !res.ok && res.error === "conflict") {
        setConflict(res.current as ScaleDocument);
        setState("conflict");
      } else setState("error");
    },
    [id, actions],
  );

  const change = React.useCallback(
    (next: { title?: string; blocks?: Block[] }) => {
      if (next.title !== undefined) setTitle(next.title);
      if (next.blocks) setBlocks(next.blocks);
      latest.current = { title: next.title ?? latest.current.title, blocks: next.blocks ?? latest.current.blocks };
      setState((s) => (s === "conflict" ? s : "dirty"));
      try {
        localStorage.setItem(draftKey(id), JSON.stringify({ base: version.current, ...latest.current }));
      } catch {
        // Not kept locally: the autosave still runs.
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!conflictRef.current) void save();
      }, 900);
    },
    [id, save],
  );

  React.useEffect(() => {
    conflictRef.current = state === "conflict";
  }, [state]);

  // Leaving with unsaved changes: the browser asks first.
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === "dirty" || state === "saving" || state === "error") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  React.useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    },
    [save],
  );

  if (failed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-muted-foreground">{failed === "not_found" ? t("missing") : t("loadFailed")}</p>
        <div className="mt-4 flex justify-center gap-2">
          {failed === "error" ? (
            <Button size="sm" onClick={() => void load()}>
              {t("retry")}
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href="/scale/strategy">{t("back")}</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-20 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  const exportHref = (format: string) => `/api/scale/documents/${id}/export?format=${format}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href="/scale/strategy" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" />
          {t("back")}
        </Link>
        <span className="ml-auto" />
        <DocSaveState state={state} onRetry={() => void save()} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <DownloadIcon />
              {t("export")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(["md", "docx", "pdf"] as const).map((f) => (
              <DropdownMenuItem key={f} asChild>
                <a href={exportHref(f)} download>
                  {t(`formats.${f}`)}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={t("more")}>
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={async () => {
                await save();
                const newId = await actions.duplicate("document", id);
                if (newId) router.push(`/scale/strategy/${newId}`);
              }}
            >
              <CopyIcon />
              {t("duplicate")}
            </DropdownMenuItem>
            {doc.archived_at ? (
              <>
                <DropdownMenuItem onSelect={async () => (await actions.archive("document", id, false)) && setDoc({ ...doc, archived_at: null })}>
                  <ArchiveRestoreIcon />
                  {t("restore")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={async () => {
                    if (window.confirm(t("deleteConfirm")) && (await actions.remove("document", id))) router.push("/scale/strategy");
                  }}
                >
                  <Trash2Icon />
                  {t("delete")}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={async () => (await actions.archive("document", id, true)) && setDoc({ ...doc, archived_at: new Date().toISOString() })}>
                <ArchiveIcon />
                {t("archive")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {draft ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <span className="flex-1">{t("draftFound")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              change({ title: draft.title, blocks: draft.blocks });
              setDraft(null);
            }}
          >
            {t("draftRestore")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              try {
                localStorage.removeItem(draftKey(id));
              } catch {
                // Nothing to clear.
              }
              setDraft(null);
            }}
          >
            {t("draftIgnore")}
          </Button>
        </div>
      ) : null}
      {conflict ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
          <span className="flex-1">{t("conflict")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!window.confirm(t("conflictLoadConfirm"))) return;
              const content = (conflict.content as unknown as Block[]) ?? [];
              setTitle(conflict.title);
              setBlocks(content.length ? content : [block("p")]);
              latest.current = { title: conflict.title, blocks: content };
              version.current = conflict.updated_at;
              setConflict(null);
              setState("saved");
            }}
          >
            {t("conflictLoad")}
          </Button>
          <Button size="sm" onClick={() => void save(conflict.updated_at)}>
            {t("conflictKeep")}
          </Button>
        </div>
      ) : null}
      {doc.archived_at ? <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t("archivedNotice")}</p> : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="min-w-0">
          <AutoArea
            value={title}
            rows={1}
            maxLength={200}
            onChange={(e) => change({ title: e.target.value.replace(/\n/g, " ") })}
            aria-label={t("titleLabel")}
            placeholder={t("titlePlaceholder")}
            className="w-full resize-none overflow-hidden bg-transparent text-[32px] font-semibold leading-tight tracking-[-0.025em] outline-none placeholder:text-muted-foreground/50"
          />
          <BlockEditor blocks={blocks} onChange={(b) => change({ blocks: b })} />
        </article>
        <aside className="space-y-6 text-sm">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("project")}</p>
            <RecordMenu
              value={doc.project_id}
              items={index.projects.map((p) => ({ id: p.id, label: p.title }))}
              onChange={async (project_id) => {
                if (await actions.update("document", id, { project_id })) setDoc({ ...doc, project_id });
              }}
              noneLabel={t("noProject")}
              ariaLabel={t("project")}
              className="-ml-2"
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("legend")}</p>
            <ul className="space-y-1.5 text-[13px]">
              <li className="border-l-[3px] border-warning pl-2">{t("kinds.hypothesis")}</li>
              <li className="border-l-[3px] border-success pl-2">{t("kinds.fact")}</li>
              <li className="border-l-[3px] border-foreground pl-2">{t("kinds.decision")}</li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">{t("slashHint")}</p>
          </div>
          <EntityExtras type="document" id={id} />
        </aside>
      </div>
    </div>
  );
}

function DocSaveState({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const t = useTranslations("scale.doc.state");
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {state === "saving" || state === "dirty" ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : state === "saved" ? <CloudCheckIcon className="size-3.5" /> : <CloudOffIcon className="size-3.5 text-destructive" />}
      <span className={cn((state === "error" || state === "conflict") && "text-destructive")}>{t(state)}</span>
      {state === "error" ? (
        <button type="button" onClick={onRetry} className="font-medium text-foreground underline-offset-2 hover:underline">
          {t("retry")}
        </button>
      ) : null}
    </span>
  );
}

// ─── The block editor ───────────────────────────────────────────────────────

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

export function BlockEditor({ blocks, onChange }: { blocks: Block[]; onChange: (b: Block[]) => void }) {
  const t = useTranslations("scale.doc");
  const refs = React.useRef(new Map<string, HTMLTextAreaElement>());
  const [slash, setSlash] = React.useState<{ id: string; active: number } | null>(null);
  const [drag, setDrag] = React.useState<string | null>(null);
  const pendingFocus = React.useRef<{ id: string; at: number | "end" } | null>(null);

  React.useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    const el = refs.current.get(f.id);
    if (el) {
      el.focus();
      const pos = f.at === "end" ? el.value.length : f.at;
      el.setSelectionRange(pos, pos);
    }
    pendingFocus.current = null;
  });

  const update = (id: string, patch: Partial<Block>) => onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const insertAfter = (id: string, b: Block) => {
    const i = blocks.findIndex((x) => x.id === id);
    const next = [...blocks.slice(0, i + 1), b, ...blocks.slice(i + 1)];
    onChange(next);
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
  const turnInto = (id: string, type: BlockType) => {
    const b = blocks.find((x) => x.id === id);
    if (!b) return;
    const patch: Partial<Block> = { type, text: b.text.startsWith("/") ? "" : b.text };
    if (type === "table" && !b.rows) patch.rows = [["", ""], ["", ""]];
    if (type === "check") patch.checked = false;
    if (type === "link") patch.url = b.url ?? "";
    update(id, patch);
    setSlash(null);
    if (type !== "divider" && type !== "table" && type !== "link") pendingFocus.current = { id, at: "end" };
  };
  const filtered = (b: Block) => {
    const q = b.text.slice(1).toLocaleLowerCase();
    return BLOCK_TYPES.filter((type) => !q || t(`types.${type}`).toLocaleLowerCase().includes(q));
  };

  // Numbered lists restart after any other kind of block.
  const numbers = blocks.reduce<number[]>((acc, b, i) => [...acc, b.type === "numbered" ? (acc[i - 1] ?? 0) + 1 : 0], []);
  return (
    <div className="mt-4 space-y-0.5 pb-24">
      {blocks.map((b, i) => {
        const number = numbers[i];
        const options = slash?.id === b.id ? filtered(b) : [];
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
                  {BLOCK_TYPES.map((type) => {
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
                  <DropdownMenuItem onSelect={() => insertAfter(b.id, { ...b, id: newBlockId(), rows: b.rows?.map((r) => [...r]) })}>
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
              <BlockBody
                b={b}
                number={number}
                inputRef={(el) => {
                  if (el) refs.current.set(b.id, el);
                  else refs.current.delete(b.id);
                }}
                onPatch={(patch) => update(b.id, patch)}
                onText={(text) => {
                  if (text.startsWith("/") && !b.text.startsWith("/") && b.type !== "table") setSlash({ id: b.id, active: 0 });
                  if (!text.startsWith("/") && slash?.id === b.id) setSlash(null);
                  update(b.id, { text });
                }}
                onKeyDown={(e, el) => {
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
                  if (e.key === " " && pos === b.text.length) {
                    const match = SHORTCUTS.find(([re]) => re.test(b.text));
                    if (match && b.type === "p") {
                      e.preventDefault();
                      update(b.id, { type: match[1], text: "", ...(match[1] === "check" ? { checked: false } : {}) });
                      return;
                    }
                    if (b.text === "---" && b.type === "p") {
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
                    if (b.type !== "p" && b.type !== "table") {
                      e.preventDefault();
                      update(b.id, { type: "p" });
                      return;
                    }
                    const prev = blocks[i - 1];
                    if (!prev) return;
                    e.preventDefault();
                    if (!b.text) remove(b.id);
                    else if (prev.type !== "table" && prev.type !== "divider" && prev.type !== "link") {
                      const joinAt = prev.text.length;
                      onChange(blocks.filter((x) => x.id !== b.id).map((x) => (x.id === prev.id ? { ...x, text: x.text + b.text } : x)));
                      pendingFocus.current = { id: prev.id, at: joinAt };
                    }
                    return;
                  }
                  if (e.key === "ArrowUp" && pos === 0 && i > 0) {
                    const prev = blocks[i - 1];
                    if (refs.current.get(prev.id)) {
                      e.preventDefault();
                      pendingFocus.current = { id: prev.id, at: "end" };
                      onChange([...blocks]);
                    }
                  }
                  if (e.key === "ArrowDown" && atEnd && i < blocks.length - 1) {
                    const next = blocks[i + 1];
                    if (refs.current.get(next.id)) {
                      e.preventDefault();
                      pendingFocus.current = { id: next.id, at: 0 };
                      onChange([...blocks]);
                    }
                  }
                }}
              />
              {slash?.id === b.id ? (
                <div role="listbox" aria-label={t("turnInto")} className="absolute left-0 top-full z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
                  {options.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">{t("noType")}</p> : null}
                  {options.map((type, k) => {
                    const Icon = ICON[type];
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
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...blocks, block("p")])} className="mt-2 flex w-full items-center gap-2 rounded-md px-1 py-2 text-left text-sm text-muted-foreground/70 hover:text-muted-foreground">
        <PlusIcon className="size-4" />
        {t("addBlock")}
      </button>
    </div>
  );
}

function BlockBody({
  b,
  number,
  inputRef,
  onText,
  onPatch,
  onKeyDown,
}: {
  b: Block;
  number: number;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  onText: (text: string) => void;
  onPatch: (patch: Partial<Block>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, el: HTMLTextAreaElement) => void;
}) {
  const t = useTranslations("scale.doc");
  const text = (className: string, placeholder?: string) => (
    <AutoArea
      ref={inputRef}
      value={b.text}
      rows={1}
      onChange={(e) => onText(e.target.value)}
      onKeyDown={(e) => onKeyDown(e, e.currentTarget)}
      placeholder={b.hint ?? placeholder ?? t("placeholder")}
      aria-label={t(`types.${b.type}`)}
      className={cn("block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/45", className)}
    />
  );

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
      return <div className="my-1 border-l-2 border-muted-foreground/40 pl-3">{text("text-[15px] italic leading-relaxed text-foreground/85")}</div>;
    case "divider":
      return <hr className="my-4 border-border" />;
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
function AutoArea({ ref, ...props }: React.ComponentProps<"textarea">) {
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
  const t = useTranslations("scale.doc");
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
