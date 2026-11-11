"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArchiveIcon, ArchiveRestoreIcon, ChevronLeftIcon, CopyIcon, EllipsisIcon, FileTextIcon, FolderInputIcon, FolderPlusIcon, InboxIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { rank } from "../logic/search";
import * as server from "../server/actions";
import { CATEGORY_ICONS, type Category, type ContentHit, type DocumentMeta } from "../types";
import { CATEGORY_ICON, CategoryGlyph, EmptyNote, PageHeader, useCategoryName, useDates } from "./primitives";
import { useShell } from "./shell";
import { useIndex } from "./selectors";
import { useStudio, useStudioActions } from "./store";

/** Pseudo-categories of the library. */
export const UNCATEGORIZED = "none";
export const ARCHIVED = "archived";

// ─── Home ───────────────────────────────────────────────────────────────────

export function KnowledgeHome() {
  const t = useTranslations("studio.knowledge");
  const data = useStudio();
  const shell = useShell();
  const [categoryDialog, setCategoryDialog] = React.useState<Category | "new" | null>(null);
  const live = data.documents.filter((d) => !d.archived_at);
  const byId = new Map(live.map((d) => [d.id, d]));
  const pinned = live.filter((d) => d.is_pinned);
  const recent = data.visits.map((v) => byId.get(v.document_id)).filter((d): d is DocumentMeta => Boolean(d)).slice(0, 6);
  const loose = live.filter((d) => !d.category_id || !data.categories.some((c) => c.id === d.category_id));
  const archived = data.documents.length - live.length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setCategoryDialog("new")}>
              <FolderPlusIcon />
              {t("newCategory")}
            </Button>
            <Button size="sm" onClick={() => shell.create("document")}>
              <PlusIcon />
              {t("newDocument")}
            </Button>
          </>
        }
      />

      <KnowledgeSearch />

      {pinned.length ? (
        <section className="mt-10" aria-labelledby="k-pinned">
          <h2 id="k-pinned" className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <PinIcon className="size-3.5" />
            {t("pinned")}
          </h2>
          <DocCards docs={pinned} />
        </section>
      ) : null}

      {recent.length ? (
        <section className="mt-10" aria-labelledby="k-recent">
          <h2 id="k-recent" className="mb-3 text-[13px] font-semibold text-muted-foreground">
            {t("recent")}
          </h2>
          <DocCards docs={recent} />
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="k-categories">
        <h2 id="k-categories" className="mb-3 text-[13px] font-semibold text-muted-foreground">
          {t("categories")}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {data.categories.map((c) => (
            <CategoryCard key={c.id} category={c} docs={live.filter((d) => d.category_id === c.id)} onEdit={() => setCategoryDialog(c)} />
          ))}
          {loose.length ? <CategoryCard category={null} docs={loose} /> : null}
          <button
            type="button"
            onClick={() => setCategoryDialog("new")}
            className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed sm:min-h-28 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PlusIcon className="size-4" />
            {t("newCategory")}
          </button>
        </div>
        {archived ? (
          <Link href={`/studio/knowledge/c/${ARCHIVED}`} className="mt-4 inline-flex items-center gap-2 rounded-md px-1 py-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArchiveIcon className="size-3.5" />
            {t("archivedLink", { count: archived })}
          </Link>
        ) : null}
      </section>

      {categoryDialog ? <CategoryDialog category={categoryDialog === "new" ? null : categoryDialog} onClose={() => setCategoryDialog(null)} /> : null}
    </div>
  );
}

function DocCards({ docs }: { docs: DocumentMeta[] }) {
  const index = useIndex();
  const dates = useDates();
  const name = useCategoryName();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {docs.map((d) => {
        const c = d.category_id ? index.categories.get(d.category_id) : null;
        return (
          <Link key={d.id} href={`/studio/knowledge/${d.id}`} className="group flex min-h-20 flex-col justify-between rounded-xl border bg-card/40 p-4 outline-none transition-all hover:-translate-y-px hover:bg-card hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring">
            <span className="line-clamp-2 text-sm font-medium leading-snug">{d.title}</span>
            <span className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              {c ? <CategoryGlyph icon={c.icon} className="size-3" /> : <FileTextIcon className="size-3" />}
              <span className="truncate">{name(c)}</span>
              <span aria-hidden>{"·"}</span>
              <span suppressHydrationWarning className="shrink-0">{dates.relative(d.updated_at)}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function CategoryCard({ category, docs, onEdit }: { category: Category | null; docs: DocumentMeta[]; onEdit?: () => void }) {
  const t = useTranslations("studio.knowledge");
  const dates = useDates();
  const name = useCategoryName();
  const actions = useStudioActions();
  const last = docs.reduce<string | null>((max, d) => (!max || d.updated_at > max ? d.updated_at : max), null);
  const href = `/studio/knowledge/c/${category?.id ?? UNCATEGORIZED}`;
  return (
    <div className="group relative">
      <Link href={href} className="flex min-h-24 flex-col justify-between rounded-xl border bg-card/40 p-3.5 sm:min-h-28 sm:p-4 outline-none transition-all hover:-translate-y-px hover:bg-card hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground/80">{category ? <CategoryGlyph icon={category.icon} /> : <InboxIcon className="size-4" />}</span>
          <span className="truncate text-[15px] font-semibold tracking-tight">{name(category)}</span>
        </span>
        <span suppressHydrationWarning className="mt-4 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{t("documents", { count: docs.length })}</span>
          {last ? ` · ${t("updated", { when: dates.relative(last) })}` : ""}
        </span>
      </Link>
      {category && onEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("categoryMenu", { name: name(category) })} className="absolute right-2 top-2 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <PencilIcon />
              {t("editCategory")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={() => {
                if (window.confirm(t("deleteCategoryConfirm", { name: name(category), count: docs.length }))) void actions.deleteCategory(category.id);
              }}
            >
              <Trash2Icon />
              {t("deleteCategory")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/** Create or rename a category, and choose its icon. */
function CategoryDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const t = useTranslations("studio.knowledge");
  const tc = useTranslations("studio.common");
  const actions = useStudioActions();
  const name = useCategoryName();
  const [value, setValue] = React.useState(category ? name(category) : "");
  const [icon, setIcon] = React.useState<string>(category?.icon ?? "folder");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = value.trim();
    if (!n) return;
    const ok = category ? await actions.updateCategory(category.id, { name: n, icon }) : Boolean(await actions.createCategory({ name: n, icon }));
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{category ? t("editCategory") : t("newCategory")}</DialogTitle>
            <DialogDescription>{t("categoryDialogHint")}</DialogDescription>
          </DialogHeader>
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} placeholder={t("categoryName")} aria-label={t("categoryName")} className="h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div role="radiogroup" aria-label={t("categoryIcon")} className="grid grid-cols-8 gap-1.5">
            {CATEGORY_ICONS.map((i) => {
              const Icon = CATEGORY_ICON[i];
              return (
                <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)} className={cn("flex aspect-square items-center justify-center rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", icon === i ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}>
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              {category ? tc("save") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Search ─────────────────────────────────────────────────────────────────

type Result = { id: string; title: string; categoryId: string | null; snippet: string | null };

/** Results for a query: titles, tags and categories at once, the documents' text a moment later. */
export function useDocumentSearch(query: string): { results: Result[]; searching: boolean } {
  const data = useStudio();
  const index = useIndex();
  const name = useCategoryName();
  const [hits, setHits] = React.useState<{ q: string; rows: ContentHit[] } | null>(null);
  const q = query.trim();

  React.useEffect(() => {
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      const res = await server.searchDocuments(q).catch(() => null);
      setHits({ q, rows: res?.ok ? res.data : [] });
    }, 180);
    return () => clearTimeout(timer);
  }, [q]);

  return React.useMemo(() => {
    if (!q) return { results: [], searching: false };
    const live = data.documents.filter((d) => !d.archived_at);
    const local = rank(q, live, (d) => [d.title, ...(d.tags ?? []), name(d.category_id ? index.categories.get(d.category_id) : null)]).map((r) => ({ score: r.score, row: { id: r.item.id, title: r.item.title, categoryId: r.item.category_id, snippet: null as string | null } }));
    const remote = hits?.q === q ? hits.rows : [];
    const merged = new Map<string, { score: number; row: Result }>();
    for (const l of local) merged.set(l.row.id, l);
    for (const h of remote) {
      const prev = merged.get(h.id);
      merged.set(h.id, { score: Math.max(prev?.score ?? 0, h.score), row: { id: h.id, title: h.title, categoryId: h.categoryId, snippet: h.snippet || null } });
    }
    return { results: [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 12).map((m) => m.row), searching: q.length >= 2 && hits?.q !== q };
  }, [q, data.documents, index, name, hits]);
}

function KnowledgeSearch() {
  const t = useTranslations("studio.knowledge");
  const router = useRouter();
  const index = useIndex();
  const name = useCategoryName();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const { results, searching } = useDocumentSearch(query);
  const current = Math.min(active, Math.max(0, results.length - 1));
  return (
    <div className="relative">
      <label className="flex h-14 items-center gap-3 rounded-2xl border bg-card/60 px-5 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/40">
        <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((current + (e.key === "ArrowDown" ? 1 : results.length - 1)) % Math.max(1, results.length));
            }
            if (e.key === "Enter" && results[current]) router.push(`/studio/knowledge/${results[current].id}`);
            if (e.key === "Escape") setQuery("");
          }}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/80"
        />
        {searching ? <span className="text-xs text-muted-foreground">{t("searching")}</span> : null}
      </label>
      {query.trim() ? (
        <div role="listbox" aria-label={t("results")} className="mt-2 overflow-hidden rounded-2xl border bg-card shadow-lg animate-message-in">
          {results.length === 0 && !searching ? <p className="px-5 py-6 text-sm text-muted-foreground">{t("noResult", { query: query.trim() })}</p> : null}
          {results.map((r, i) => {
            const c = r.categoryId ? index.categories.get(r.categoryId) : null;
            return (
              <Link
                key={r.id}
                href={`/studio/knowledge/${r.id}`}
                role="option"
                aria-selected={i === current}
                onMouseEnter={() => setActive(i)}
                className={cn("flex gap-3 border-b px-5 py-3 last:border-b-0 outline-none", i === current ? "bg-accent/60" : "hover:bg-accent/40")}
              >
                <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{name(c)}</span>
                  </span>
                  {r.snippet ? <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{r.snippet}</span> : null}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ─── A category's documents ─────────────────────────────────────────────────

export function CategoryPage({ id }: { id: string }) {
  const t = useTranslations("studio.knowledge");
  const data = useStudio();
  const shell = useShell();
  const name = useCategoryName();
  const [filter, setFilter] = React.useState("");
  const category = data.categories.find((c) => c.id === id) ?? null;
  const known = new Set(data.categories.map((c) => c.id));
  if (!category && id !== UNCATEGORIZED && id !== ARCHIVED) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-muted-foreground">{t("categoryMissing")}</p>
        <Button asChild size="sm" variant="outline" className="mt-4">
          <Link href="/studio/knowledge">{t("back")}</Link>
        </Button>
      </div>
    );
  }
  const docs = data.documents
    .filter((d) => (id === ARCHIVED ? d.archived_at : !d.archived_at && (category ? d.category_id === category.id : !d.category_id || !known.has(d.category_id))))
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at.localeCompare(a.updated_at));
  const shown = filter.trim() ? rank(filter, docs, (d) => [d.title, ...(d.tags ?? [])]).map((r) => r.item) : docs;
  const title = id === ARCHIVED ? t("archivedTitle") : name(category);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/studio/knowledge" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" />
        {t("title")}
      </Link>
      <PageHeader
        title={title}
        description={t("documents", { count: docs.length })}
        actions={
          id === ARCHIVED ? null : (
            <Button size="sm" onClick={() => shell.create("document", { category_id: category?.id ?? null })}>
              <PlusIcon />
              {t("newDocument")}
            </Button>
          )
        }
      />
      {docs.length > 6 ? (
        <label className="mb-4 flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:max-w-72">
          <SearchIcon className="size-3.5" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("filter")} aria-label={t("filter")} className="min-w-0 flex-1 bg-transparent text-foreground outline-none" />
        </label>
      ) : null}
      {docs.length === 0 ? (
        <EmptyNote
          icon={id === ARCHIVED ? <ArchiveIcon /> : <FileTextIcon />}
          title={id === ARCHIVED ? t("noArchived") : t("emptyCategory")}
          body={id === ARCHIVED ? undefined : t("emptyCategoryBody")}
          action={
            id === ARCHIVED ? null : (
              <Button size="sm" onClick={() => shell.create("document", { category_id: category?.id ?? null })}>
                <PlusIcon />
                {t("newDocument")}
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card/30">
          {shown.map((d) => (
            <DocumentRow key={d.id} doc={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentRow({ doc }: { doc: DocumentMeta }) {
  const t = useTranslations("studio.knowledge");
  const dates = useDates();
  return (
    <li className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      <Link href={`/studio/knowledge/${doc.id}`} className="min-w-0 flex-1 outline-none focus-visible:underline">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{doc.title}</span>
          {doc.is_pinned ? <PinIcon aria-label={t("pinnedBadge")} className="size-3 shrink-0 text-muted-foreground" /> : null}
        </span>
        <span suppressHydrationWarning className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {t("updated", { when: dates.relative(doc.updated_at) })}
          {(doc.tags ?? []).slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-2 py-px">
              {tag}
            </span>
          ))}
        </span>
      </Link>
      <DocumentMenu doc={doc} />
    </li>
  );
}

/** Pin, move, duplicate, archive or delete a document (the same menu in a list and in the editor). */
export function DocumentMenu({ doc, onDeleted, onBeforeDuplicate }: { doc: DocumentMeta; onDeleted?: () => void; onBeforeDuplicate?: () => Promise<void> }) {
  const t = useTranslations("studio.knowledge");
  const data = useStudio();
  const actions = useStudioActions();
  const router = useRouter();
  const name = useCategoryName();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("documentMenu", { title: doc.title })} className="shrink-0 text-muted-foreground">
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => void actions.updateDocument(doc.id, { is_pinned: !doc.is_pinned })}>
          {doc.is_pinned ? <PinOffIcon /> : <PinIcon />}
          {doc.is_pinned ? t("unpin") : t("pin")}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderInputIcon />
            {t("move")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
            {data.categories.map((c) => (
              <DropdownMenuItem key={c.id} disabled={c.id === doc.category_id} onSelect={() => void actions.updateDocument(doc.id, { category_id: c.id })}>
                <CategoryGlyph icon={c.icon} className="text-muted-foreground" />
                {name(c)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!doc.category_id} onSelect={() => void actions.updateDocument(doc.id, { category_id: null })}>
              {name(null)}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onSelect={async () => {
            await onBeforeDuplicate?.();
            const copy = await actions.duplicateDocument(doc.id, t("copySuffix"));
            if (copy) router.push(`/studio/knowledge/${copy.id}`);
          }}
        >
          <CopyIcon />
          {t("duplicate")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {doc.archived_at ? (
          <DropdownMenuItem onSelect={() => void actions.updateDocument(doc.id, { archived: false })}>
            <ArchiveRestoreIcon />
            {t("restore")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void actions.updateDocument(doc.id, { archived: true })}>
            <ArchiveIcon />
            {t("archive")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            if (window.confirm(t("deleteConfirm", { title: doc.title })) && (await actions.deleteDocument(doc.id))) onDeleted?.();
          }}
        >
          <Trash2Icon />
          {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
