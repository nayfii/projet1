"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/public-env";
import type { Database } from "./database.types";

/** Browser client (realtime, uploads). Same RLS rules as the server user client. */
export function createBrowserSupabase() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey);
}
