"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRightIcon, CloudCheckIcon, CloudOffIcon, DownloadIcon, FileTextIcon, FlagIcon, LoaderCircleIcon, PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { block, type Block } from "../logic/blocks";
import * as server from "../server/actions";
import type { DocumentMeta, StudioDocument } from "../types";
import { AutoArea, BlockEditor } from "./block-editor";
import { ARCHIVED, DocumentMenu, UNCATEGORIZED } from "./knowledge";
import { CategoryGlyph, CategoryMenu, StatusIcon, useCategoryName, useDates } from "./primitives";
import { useIndex } from "./selectors";
import { usePanel, useStudio, useStudioActions } from "./store";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
const draftKey = (id: string) => `cendr-studio:doc-draft:${id}`;

/** A Knowledge document: saved automatically, never overwriting someone else's newer version. */
export function DocumentEditor({ id }: { id: string }) {
  const t = useTranslations("studio.doc");
  const data = useStudio();
  const actions = useStudioActions();
  const router = useRouter();
  const name = useCategoryName();
  const dates = useDates();
  const [doc, setDoc] = React.useState<StudioDocument | null>(null);
  const [failed, setFailed] = React.useState<null | "not_found" | "error">(null);
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [title, setTitle] = React.useState("");
  const [state, setState] = React.useState<SaveState>("saved");
  const [conflict, setConflict] = React.useState<StudioDocument | null>(null);
  const [draft, setDraft] = React.useState<{ title: string; blocks: Block[] } | null>(null);
  const version = React.useRef("");
  const conflictRef = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef({ title: "", blocks: [] as Block[] });
  // Category, tags, pin and archive live in the shared store (changed from lists too).
  const meta = data.documents.find((d) => d.id === id) ?? null;

  const load = React.useCallback(async () => {
    setFailed(null);
    const res = await server.openDocument(id).catch(() => null);
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
    const { content: _content, ...rest } = d;
    void _content;
    actions.localDocument(rest as DocumentMeta, true);
    try {
      const raw = localStorage.getItem(draftKey(id));
      if (raw) {
        const saved = JSON.parse(raw) as { title: string; blocks: Block[] };
        if (JSON.stringify(saved.blocks) !== JSON.stringify(content) || saved.title !== d.title) setDraft({ title: saved.title, blocks: saved.blocks });
        else localStorage.removeItem(draftKey(id));
      }
    } catch {
      // No draft kept in this browser.
    }
  }, [id, actions]);

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
        const { content: _content, ...rest } = res.data;
        void _content;
        actions.localDocument(rest as DocumentMeta);
        try {
          localStorage.removeItem(draftKey(id));
        } catch {
          // Nothing to clear.
        }
      } else if (res && !res.ok && res.error === "conflict") {
        setConflict(res.current as StudioDocument);
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
        localStorage.setItem(draftKey(id), JSON.stringify(latest.current));
      } catch {
        // Not kept locally: the autosave still runs.
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!conflictRef.current) void save();
      }, 800);
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

  // Leaving the page within Studio: what is pending is saved first.
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
            <Link href="/studio/knowledge">{t("back")}</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (!doc || !meta) {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-20 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  const category = meta.category_id ? data.categories.find((c) => c.id === meta.category_id) : null;
  const exportHref = (format: string) => `/api/studio/documents/${id}/export?format=${format}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <nav aria-label={t("breadcrumb")} className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
          <Link href="/studio/knowledge" className="hover:text-foreground">
            {t("knowledge")}
          </Link>
          <ChevronRightIcon className="size-3.5 shrink-0" />
          <Link href={`/studio/knowledge/c/${meta.archived_at ? ARCHIVED : (category?.id ?? UNCATEGORIZED)}`} className="flex min-w-0 items-center gap-1.5 hover:text-foreground">
            {category ? <CategoryGlyph icon={category.icon} className="size-3.5" /> : null}
            <span className="truncate">{meta.archived_at ? t("archived") : name(category)}</span>
          </Link>
        </nav>
        <span className="ml-auto" />
        <DocSaveState state={state} onRetry={() => void save()} />
        <Tooltip content={meta.is_pinned ? t("unpin") : t("pin")}>
          <Button variant="ghost" size="icon-sm" aria-label={meta.is_pinned ? t("unpin") : t("pin")} aria-pressed={meta.is_pinned} onClick={() => void actions.updateDocument(id, { is_pinned: !meta.is_pinned })} className={cn(meta.is_pinned ? "text-foreground" : "text-muted-foreground")}>
            {meta.is_pinned ? <PinOffIcon /> : <PinIcon />}
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="text-muted-foreground">
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
        <DocumentMenu doc={meta} onDeleted={() => router.push("/studio/knowledge")} onBeforeDuplicate={() => save()} />
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
      {meta.archived_at ? <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t("archivedNotice")}</p> : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <article className="mx-auto w-full min-w-0 max-w-3xl">
          <AutoArea
            value={title}
            rows={1}
            maxLength={200}
            onChange={(e) => change({ title: e.target.value.replace(/\n/g, " ") })}
            aria-label={t("titleLabel")}
            placeholder={t("titlePlaceholder")}
            className="w-full resize-none overflow-hidden bg-transparent text-[34px] font-semibold leading-tight tracking-[-0.025em] outline-none placeholder:text-muted-foreground/50"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <CategoryMenu value={meta.category_id} categories={data.categories} onChange={(category_id) => void actions.updateDocument(id, { category_id })} className="-ml-2" />
            <TagsEditor tags={meta.tags ?? []} onChange={(tags) => void actions.updateDocument(id, { tags })} />
            <span suppressHydrationWarning className="ml-auto text-xs">{t("updated", { when: dates.relative(meta.updated_at) })}</span>
          </div>
          <BlockEditor documentId={id} blocks={blocks} onChange={(b) => change({ blocks: b })} />
        </article>
        <aside className="space-y-6 text-sm lg:pt-20">
          <p suppressHydrationWarning className="text-xs text-muted-foreground">
            {t("created", { date: dates.long(meta.created_at.slice(0, 10)) })}
          </p>
          <UsedBy documentId={id} />
          <Mentions documentId={id} version={meta.updated_at} />
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
        </aside>
      </div>
    </div>
  );
}

function DocSaveState({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const t = useTranslations("studio.doc.state");
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

/** Tags: type and Enter (or a comma) to add, × to remove. */
function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const t = useTranslations("studio.doc");
  const [draft, setDraft] = React.useState("");
  const add = () => {
    const tag = draft.trim().replace(/,$/, "").slice(0, 40);
    setDraft("");
    if (tag && !tags.some((x) => x.toLocaleLowerCase() === tag.toLocaleLowerCase()) && tags.length < 20) onChange([...tags, tag]);
  };
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/80">
          {tag}
          <button type="button" aria-label={t("removeTag", { tag })} onClick={() => onChange(tags.filter((x) => x !== tag))} className="rounded-full text-muted-foreground hover:text-foreground">
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          if (e.target.value.endsWith(",")) add();
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
          if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={add}
        placeholder={tags.length ? "" : t("addTags")}
        aria-label={t("addTags")}
        maxLength={41}
        className="h-6 w-36 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
      />
    </span>
  );
}

/** The tasks and milestones this document goes with. */
function UsedBy({ documentId }: { documentId: string }) {
  const t = useTranslations("studio.doc");
  const data = useStudio();
  const index = useIndex();
  const panel = usePanel();
  const tasks = data.taskDocuments.filter((l) => l.document_id === documentId).map((l) => data.tasks.find((x) => x.id === l.task_id)).filter((x) => x !== undefined);
  const milestones = data.milestoneDocuments.filter((l) => l.document_id === documentId).map((l) => index.milestones.get(l.milestone_id)).filter((m) => m !== undefined);
  if (!tasks.length && !milestones.length) return null;
  return (
    <section aria-label={t("usedBy")}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("usedBy")}</p>
      <ul className="space-y-1">
        {milestones.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => panel.open("milestone", m.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent/60">
              <FlagIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{m.title}</span>
            </button>
          </li>
        ))}
        {tasks.map((x) => (
          <li key={x.id}>
            <button type="button" onClick={() => panel.open("task", x.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent/60">
              <StatusIcon status={x.status === "cancelled" ? "done" : x.status} className="size-3.5" />
              <span className={cn("truncate", x.status === "done" && "text-muted-foreground line-through")}>{x.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Other documents that link to this one. */
function Mentions({ documentId, version }: { documentId: string; version: string }) {
  const t = useTranslations("studio.doc");
  const [rows, setRows] = React.useState<{ id: string; title: string }[]>([]);
  React.useEffect(() => {
    let alive = true;
    void server.documentMentions(documentId).then((res) => alive && res.ok && setRows(res.data));
    return () => {
      alive = false;
    };
  }, [documentId, version]);
  if (!rows.length) return null;
  return (
    <section aria-label={t("mentionedIn")}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("mentionedIn")}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/studio/knowledge/${r.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-accent/60">
              <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{r.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
