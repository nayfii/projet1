"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownLeftIcon,
  GitBranchIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  deleteConversationAction,
  renameConversationAction,
  searchConversationsAction,
  setConversationArchivedAction,
  setConversationPinnedAction,
  type SearchHit,
} from "../server/actions";
import { useChatList, type ChatListItem } from "./chat-list";

/** Sidebar part of the chat: search and recent conversations. */
export function ChatSidebarSection() {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const { items } = useChatList();
  const [searching, setSearching] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const pinned = items.filter((c) => c.pinnedAt && !c.archivedAt).sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
  const recent = items.filter((c) => !c.pinnedAt && !c.archivedAt);
  const archived = items.filter((c) => c.archivedAt);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-0.5">
      {/* In the narrow rail: search stays one click (or Ctrl K) away; recent conversations wait for the full sidebar. */}
      <Tooltip content={t("search")} side="right">
        <button type="button" onClick={() => setSearching(true)} aria-label={t("search")} className="glass-interactive mx-auto hidden size-10 items-center justify-center rounded-[11px] text-muted-foreground hover:text-foreground rail:flex">
          <SearchIcon className="size-[17px]" />
        </button>
      </Tooltip>
      <div className="space-y-0.5 rail:hidden">
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="glass-interactive flex h-8 w-full items-center gap-2.5 rounded-[11px] px-2.5 text-[13.5px] text-muted-foreground hover:text-foreground"
        >
          <SearchIcon className="size-4 shrink-0" />
          <span className="flex-1 text-left">{t("search")}</span>
          <kbd className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-1.5 font-sans text-[10px] text-muted-foreground/80">{t("searchShortcut")}</kbd>
        </button>

        {pinned.length > 0 ? (
          <>
            <p className="px-2.5 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">{t("pinned")}</p>
            {pinned.map((c) => (
              <ConversationRow key={c.id} item={c} active={pathname === `/chat/${c.id}`} />
            ))}
          </>
        ) : null}
        <p className="px-2.5 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">{t("recent")}</p>
        {recent.length === 0 ? (
          <p className="px-2.5 py-1 text-[13px] text-muted-foreground/80">{t("noConversationsYet")}</p>
        ) : (
          recent.map((c) => <ConversationRow key={c.id} item={c} active={pathname === `/chat/${c.id}`} />)
        )}
        {archived.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="flex w-full items-center gap-1.5 px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 hover:text-foreground"
            >
              <ArchiveIcon className="size-3" />
              {t("archived", { count: archived.length })}
            </button>
            {showArchived ? archived.map((c) => <ConversationRow key={c.id} item={c} active={pathname === `/chat/${c.id}`} />) : null}
          </>
        ) : null}
      </div>

      <Dialog open={searching} onOpenChange={setSearching}>
        <DialogContent className="max-w-xl gap-0 p-0" closeLabel={tCommon("close")}>
          <DialogTitle className="sr-only">{t("search")}</DialogTitle>
          {searching ? <SearchPanel onPick={() => setSearching(false)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Private is the default and shows nothing; shared, copy and received get a small mark. */
export function KindMark({ kind, className }: { kind?: string; className?: string }) {
  const t = useTranslations("chat");
  if (kind !== "shared" && kind !== "copy" && kind !== "received") return null;
  const Icon = kind === "shared" ? UsersIcon : kind === "copy" ? GitBranchIcon : ArrowDownLeftIcon;
  const label = t(`kind.${kind}`);
  return (
    <span title={label} className={cn("inline-flex shrink-0 text-muted-foreground/70", className)}>
      <Icon aria-hidden className="size-3" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function SearchPanel({ onPick }: { onPick: () => void }) {
  const t = useTranslations("chat");
  const format = useFormatter();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  const q = query.trim();
  const active = q.length >= 2;
  const shown = active ? hits : null;

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchConversationsAction(q);
      if (!cancelled) {
        setHits(result);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, active]);

  return (
    <div>
      <div className="flex items-center gap-2 border-b px-4">
        <SearchIcon className="size-4 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/80"
        />
        {loading && active ? <Spinner className="text-muted-foreground" /> : null}
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-2">
        {shown === null ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("searchHint")}</p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("searchEmpty")}</p>
        ) : (
          shown.map((h) => (
            <button
              key={h.conversationId}
              type="button"
              onClick={() => {
                onPick();
                router.push(`/chat/${h.conversationId}`);
              }}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
            >
              <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{h.title ?? t("untitled")}</span>
                  {h.matchedAt ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{format.dateTime(new Date(h.matchedAt), { dateStyle: "medium" })}</span>
                  ) : null}
                </span>
                {h.snippet ? <Snippet text={h.snippet} /> : null}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Renders the database's highlight markers (U+0002 … U+0003) as <mark>, without any HTML injection. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g);
  return (
    <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">
      {parts.map((part, i) =>
        part.startsWith("\u0002") ? (
          <mark key={i} className="rounded bg-brand-soft px-0.5 text-foreground">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </span>
  );
}

/**
 * One conversation in the sidebar: its title, a discreet mark while an answer is being written (or
 * a dot once it finished elsewhere), and a menu to rename, pin, archive or delete it.
 */
function ConversationRow({ item, active }: { item: ChatListItem; active: boolean }) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { generating, finished, upsert, remove, markSeen } = useChatList();
  const [renaming, setRenaming] = React.useState(false);
  const [title, setTitle] = React.useState(item.title ?? "");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const busy = generating.has(item.id);
  const done = !busy && finished.has(item.id);
  React.useEffect(() => {
    if (active) markSeen(item.id);
  }, [active, item.id, markSeen]);

  const rename = async () => {
    const next = title.trim();
    setRenaming(false);
    if (!next || next === item.title) return;
    upsert({ id: item.id, title: next, lastMessageAt: item.lastMessageAt });
    const result = await renameConversationAction({ conversationId: item.id, title: next });
    if (!result.ok) toast.error(tErrors(result.error));
  };
  const setFlag = async (flag: "pin" | "archive", on: boolean) => {
    const now = new Date().toISOString();
    upsert(flag === "pin" ? { id: item.id, pinnedAt: on ? now : null, lastMessageAt: item.lastMessageAt } : { id: item.id, archivedAt: on ? now : null, pinnedAt: null, lastMessageAt: item.lastMessageAt });
    const result =
      flag === "pin"
        ? await setConversationPinnedAction({ conversationId: item.id, pinned: on })
        : await setConversationArchivedAction({ conversationId: item.id, archived: on });
    if (!result.ok) toast.error(tErrors(result.error));
    else if (flag === "archive" && on) toast(t("archivedToast"), { action: { label: t("undo"), onClick: () => void setFlag("archive", false) } });
  };

  if (renaming) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void rename();
        }}
        className="px-1"
      >
        <input
          autoFocus
          value={title}
          maxLength={200}
          aria-label={t("rename")}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setTitle(item.title ?? "");
              setRenaming(false);
            }
          }}
          className="h-[30px] w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>
    );
  }

  return (
    <div className="group/row relative" data-testid="conversation-row">
      <Link
        href={`/chat/${item.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "glass-interactive flex min-h-8 flex-col justify-center rounded-[11px] py-1 pl-2.5 pr-8 text-[13.5px]",
          active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{item.title ?? t("untitled")}</span>
          <KindMark kind={item.kind} />
        </span>
        {item.clientName ? <span className="truncate text-[11px] font-normal text-muted-foreground/80">{item.clientName}</span> : null}
      </Link>
      {/* Above the row's link (which the glass styles can raise), so they stay clickable. */}
      <span className="pointer-events-none absolute right-2 top-1/2 z-[2] -translate-y-1/2 group-focus-within/row:opacity-0 group-hover/row:opacity-0">
        {busy ? (
          <span className="flex size-4 items-center justify-center" role="status" aria-label={t("generating")} data-testid="row-generating">
            <span className="size-1.5 animate-ping rounded-full bg-brand" />
          </span>
        ) : done ? (
          <span className="block size-1.5 rounded-full bg-brand" aria-label={t("answerReady")} data-testid="row-finished" />
        ) : null}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("rowActions", { title: item.title ?? t("untitled") })}
            className="absolute right-1 top-1/2 z-[2] flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilIcon />
            {t("rename")}
          </DropdownMenuItem>
          {!item.archivedAt ? (
            <DropdownMenuItem onSelect={() => void setFlag("pin", !item.pinnedAt)}>
              {item.pinnedAt ? <PinOffIcon /> : <PinIcon />}
              {item.pinnedAt ? t("unpin") : t("pin")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void setFlag("archive", !item.archivedAt)}>
            {item.archivedAt ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
            {item.archivedAt ? t("unarchive") : t("archive")}
          </DropdownMenuItem>
          {item.mine !== false ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                <Trash2Icon />
                {t("delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm" closeLabel={tCommon("close")}>
          <DialogTitle>{t("deleteTitle")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("deleteBody")}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setConfirmDelete(false);
                const result = await deleteConversationAction({ conversationId: item.id });
                if (!result.ok) return void toast.error(tErrors(result.error));
                remove(item.id);
                if (active) router.push("/chat");
              }}
            >
              {t("delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
