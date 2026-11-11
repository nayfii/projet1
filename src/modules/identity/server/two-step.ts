import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Whether the signed-in person has two-step sign-in on. A person who has it can only be here with a
 * session that passed it (the database refuses the rest), so the session's assurance level says it.
 */
export async function twoStepEnabled(): Promise<boolean> {
  const { data } = await (await createClient()).auth.getClaims();
  return data?.claims.aal === "aal2";
}
