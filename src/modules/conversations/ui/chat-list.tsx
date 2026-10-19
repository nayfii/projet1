"use client";

import * as React from "react";

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
export function ChatListProvider({ initial, children }: { initial: ChatListItem[]; children: React.ReactNode }) {
  const [items, setItems] = React.useState(initial);
  // Server data wins whenever the layout re-renders (after a rename, a deletion…).
  const [seed, setSeed] = React.useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setItems(initial);
  }

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
