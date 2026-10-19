"use client";

import * as React from "react";
import { useMyConversationsRealtime } from "@/modules/collaboration/ui/use-my-conversations-realtime";
import { loadConversationListAction } from "../server/actions";

export type ChatListItem = { id: string; title: string | null; clientId: string | null; clientName: string | null; lastMessageAt: string };

type ChatListValue = {
  items: ChatListItem[];
  upsert: (item: Partial<ChatListItem> & { id: string }) => void;
  remove: (id: string) => void;
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

  const value = React.useMemo<ChatListValue>(
    () => ({
      items,
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
    [items],
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
