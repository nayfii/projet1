import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUILTIN_AGENTS } from "../builtins";

/**
 * AUDITED service-role module (docs/ARCHITECTURE.md §5). Built-in agents are defined in code
 * (`builtins.ts`); this keeps their rows in `agents` (company_id null) identical to the code, once per
 * server process. Users cannot write built-in rows: only this module does. No company data involved.
 */
let synced: Promise<void> | null = null;

export function ensureBuiltinAgents(): Promise<void> {
  synced ??= sync().catch((error: unknown) => {
    // Retried on the next request; the library still lists company tools meanwhile.
    synced = null;
    console.error("built-in agents sync failed", { code: (error as { code?: string })?.code });
  });
  return synced;
}

async function sync(): Promise<void> {
  const rows = BUILTIN_AGENTS.map((a) => ({
    builtin_key: a.key,
    kind: "agent",
    department: a.department,
    name: a.name,
    description: a.description,
    instructions: a.instructions,
    input_fields: a.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, ...(f.options ? { options: f.options } : {}) })),
    tools: a.tools,
    memory_scope: a.memoryScope,
    output_format: a.outputFormat,
    visibility: "private",
    publication: "none",
  }));
  const { error } = await createAdminClient().from("agents").upsert(rows, { onConflict: "builtin_key" });
  if (error) throw error;
}
