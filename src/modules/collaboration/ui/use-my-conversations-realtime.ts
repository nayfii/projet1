"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/lib/supabase/client";

/** Calls `onAdded` when a colleague adds this person to a conversation (or transfers one to them). */
export function useMyConversationsRealtime(meId: string, onAdded: () => void) {
  const handler = React.useRef(onAdded);
  React.useEffect(() => {
    handler.current = onAdded;
  });

  React.useEffect(() => {
    const supabase = createBrowserSupabase();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      // RLS applies: only rows of conversations this person can now see are delivered.
      channel = supabase
        .channel(`participants:${meId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_participants", filter: `user_id=eq.${meId}` }, () => handler.current())
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [meId]);
}
