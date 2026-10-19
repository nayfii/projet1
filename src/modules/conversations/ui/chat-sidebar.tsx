"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { MessageSquareIcon, SearchIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { searchConversationsAction, type SearchHit } from "../server/actions";
import { useChatList } from "./chat-list";

/** Sidebar part of the chat: search and recent conversations. */
export function ChatSidebarSection() {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const { items } = useChatList();
  const [searching, setSearching] = React.useState(false);

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
      <button
        type="button"
        onClick={() => setSearching(true)}
        className="flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-foreground"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="flex-1 text-left">{t("search")}</span>
        <kbd className="rounded border px-1 font-sans text-[10px] text-muted-foreground/80">{t("searchShortcut")}</kbd>
      </button>

      <p className="px-2 pb-0.5 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{t("recent")}</p>
      {items.length === 0 ? (
        <p className="px-2 py-1 text-[13px] text-muted-foreground/80">{t("noConversationsYet")}</p>
      ) : (
        items.map((c) => {
          const href = `/chat/${c.id}`;
          const active = pathname === href;
          return (
            <Link
              key={c.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[30px] flex-col justify-center rounded-md px-2 py-1 text-sm transition-colors",
                active ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
            >
              <span className="truncate">{c.title ?? t("untitled")}</span>
              {c.clientName ? <span className="truncate text-[11px] font-normal text-muted-foreground/80">{c.clientName}</span> : null}
            </Link>
          );
        })
      )}

      <Dialog open={searching} onOpenChange={setSearching}>
        <DialogContent className="max-w-xl gap-0 p-0" closeLabel={tCommon("close")}>
          <DialogTitle className="sr-only">{t("search")}</DialogTitle>
          {searching ? <SearchPanel onPick={() => setSearching(false)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
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
