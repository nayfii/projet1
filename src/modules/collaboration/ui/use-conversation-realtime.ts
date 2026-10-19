"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Real time for one conversation (Supabase Realtime):
 * - new or updated messages and participant changes (Postgres Changes: RLS applies, so each person
 *   only hears about messages they may see);
 * - who is here and who is typing (Presence on the private channel "conversation:<id>", which only
 *   the conversation's participants may join).
 */
export function useConversationRealtime({
  conversationId,
  meId,
  onMessage,
  onParticipants,
}: {
  conversationId: string | null;
  meId: string;
  onMessage: (messageId: string) => void;
  onParticipants: () => void;
}) {
  const [online, setOnline] = React.useState<Set<string>>(new Set());
  const [typing, setTyping] = React.useState<Set<string>>(new Set());
  const channelRef = React.useRef<RealtimeChannel | null>(null);
  const handlers = React.useRef({ onMessage, onParticipants });
  React.useEffect(() => {
    handlers.current = { onMessage, onParticipants };
  });

  React.useEffect(() => {
    if (!conversationId) return;
    const supabase = createBrowserSupabase();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    void (async () => {
      // Private channels are authorised with the person's own session.
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      const ch = supabase.channel(`conversation:${conversationId}`, { config: { private: true, presence: { key: meId } } });
      ch.on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const id = (payload.new as { id?: string } | null)?.id;
        if (id) handlers.current.onMessage(id);
      })
        .on("postgres_changes", { event: "*", schema: "public", table: "conversation_participants", filter: `conversation_id=eq.${conversationId}` }, () =>
          handlers.current.onParticipants(),
        )
        .on("presence", { event: "sync" }, () => {
          const state = ch.presenceState<{ typing?: boolean }>();
          setOnline(new Set(Object.keys(state)));
          setTyping(new Set(Object.entries(state).filter(([key, metas]) => key !== meId && metas.some((m) => m.typing)).map(([key]) => key)));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void ch.track({ typing: false });
        });
      channel = ch;
      channelRef.current = ch;
    })();
    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [conversationId, meId]);

  // "Is typing…": announced at most every 1.5 s, withdrawn 3 s after the last keystroke.
  const lastSent = React.useRef(0);
  const stopTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyTyping = React.useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const now = Date.now();
    if (now - lastSent.current > 1500) {
      lastSent.current = now;
      void ch.track({ typing: true });
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      lastSent.current = 0;
      void channelRef.current?.track({ typing: false });
    }, 3000);
  }, []);

  return { online, typing, notifyTyping };
}
