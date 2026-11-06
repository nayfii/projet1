"use client";

import * as React from "react";
import { useMyConversationsRealtime } from "@/modules/collaboration/ui/use-my-conversations-realtime";
import { generatingConversationsAction, loadConversationListAction } from "../server/actions";

import type { ConversationKind } from "../server/queries";

export type ChatListItem = {
  id: string;
  title: string | null;
  clientId: string | null;
  clientName: string | null;
  lastMessageAt: string;
  kind?: ConversationKind;
  otherName?: string | null;
  /** The viewer started it (only then can they delete it). */
  mine?: boolean;
  /** The viewer's own pin and archive. */
  pinnedAt?: string | null;
  archivedAt?: string | null;
};

type ChatListValue = {
  items: ChatListItem[];
  upsert: (item: Partial<ChatListItem> & { id: string }) => void;
  remove: (id: string) => void;
  /** Conversations where an answer is being written (here or on the server after leaving). */
  generating: ReadonlySet<string>;
  /** Answers finished while the person was elsewhere: a dot until they open the conversation. */
  finished: ReadonlySet<string>;
  setGenerating: (id: string, on: boolean) => void;
  markSeen: (id: string) => void;
};

const ChatListContext = React.createContext<ChatListValue | null>(null);

/**
 * Recent conversations shown in the sidebar. Seeded by the server (RLS-filtered) and updated
 * instantly by the chat view, so a new conversation appears without reloading the page.
 */
export function ChatListProvider({ initial, meId, children }: { initial: ChatListItem[]; meId: string; children: React.ReactNode }) {
  const [items, setItems] = React.useState(initial);
  // Server data wins whenever the layout re-renders (after a rename, a deletion…).
  const [seed, setSeed] = React.useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setItems(initial);
  }
  // A colleague added this person to a conversation (or transferred one): it appears right away.
  // Only new conversations are added; those already listed keep their live state (e.g. a title
  // derived in this browser before the server has saved it).
  useMyConversationsRealtime(meId, () => {
    void loadConversationListAction().then((list) => {
      if (!list) return;
      setItems((current) => {
        const known = new Set(current.map((c) => c.id));
        return [...list.filter((c) => !known.has(c.id)), ...current].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      });
    });
  });

  // Generation status: this browser's own streams, plus the server's view (answers keep being
  // written after leaving a conversation, or were started on another device).
  const [local, setLocal] = React.useState<ReadonlySet<string>>(new Set());
  const [remote, setRemote] = React.useState<ReadonlySet<string>>(new Set());
  const [finished, setFinished] = React.useState<ReadonlySet<string>>(new Set());
  const generating = React.useMemo(() => new Set([...local, ...remote]), [local, remote]);
  // An answer that ends while its conversation is not open leaves a dot (computed during render,
  // React's pattern for state derived from a change).
  const [previous, setPrevious] = React.useState<ReadonlySet<string>>(generating);
  if (previous !== generating) {
    setPrevious(generating);
    const here = typeof window === "undefined" ? "" : window.location.pathname;
    const away = [...previous].filter((id) => !generating.has(id) && here !== `/chat/${id}`);
    if (away.length) setFinished((f) => new Set([...f, ...away]));
  }
  const poll = React.useCallback(() => {
    void generatingConversationsAction().then((ids) => setRemote(new Set(ids)));
  }, []);
  React.useEffect(() => {
    poll();
    window.addEventListener("focus", poll);
    return () => window.removeEventListener("focus", poll);
  }, [poll]);
  React.useEffect(() => {
    if (generating.size === 0) return;
    const timer = window.setInterval(poll, 3000);
    return () => window.clearInterval(timer);
  }, [generating.size, poll]);

  const value = React.useMemo<ChatListValue>(
    () => ({
      items,
      generating,
      finished,
      setGenerating: (id, on) =>
        setLocal((current) => {
          if (on === current.has(id)) return current;
          const next = new Set(current);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        }),
      markSeen: (id) =>
        setFinished((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        }),
      upsert: (item) =>
        setItems((current) => {
          const existing = current.find((c) => c.id === item.id);
          const merged: ChatListItem = {
            title: null,
            clientId: null,
            clientName: null,
            lastMessageAt: new Date().toISOString(),
            ...existing,
            ...item,
          };
          return [merged, ...current.filter((c) => c.id !== item.id)].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
        }),
      remove: (id) => setItems((current) => current.filter((c) => c.id !== id)),
    }),
    [items, generating, finished],
  );
  return <ChatListContext.Provider value={value}>{children}</ChatListContext.Provider>;
}

export function useChatList(): ChatListValue {
  const value = React.useContext(ChatListContext);
  if (!value) throw new Error("useChatList must be used inside ChatListProvider");
  return value;
}

/** Same rule as the database trigger: first 80 characters of the first message, spaces collapsed. */
export function titleFromMessage(text: string): string | null {
  const title = text.trim().replace(/\s+/g, " ").slice(0, 80);
  return title || null;
}
