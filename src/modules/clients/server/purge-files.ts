import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * AUDITED service-role use (docs/ARCHITECTURE.md §5). After delete_client has checked that the caller
 * is the Owner and has deleted the client, removes the files of its documents. The paths come only
 * from that function's return value, never from the browser.
 */
export async function purgeClientDocumentFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const storage = createAdminClient().storage.from("memory-documents");
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await storage.remove(paths.slice(i, i + 100));
    // The client is already gone; a file left behind is unreachable (no row points to it) and only logged.
    if (error) console.error("client purge: some document files could not be removed", { count: paths.length });
  }
}
