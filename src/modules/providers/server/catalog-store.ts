import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type ModelRow = Database["public"]["Tables"]["ai_models"]["Row"];

/**
 * The model catalogue with our price estimates. Customers may not read the dollar prices (credits
 * only, CLAUDE.md §11): the server reads them with its own key. The catalogue holds no customer data.
 * Read once per request.
 */
export const readCatalog = cache(async (): Promise<ModelRow[]> => {
  const { data } = await createAdminClient().from("ai_models").select("*").order("sort_order");
  return data ?? [];
});
