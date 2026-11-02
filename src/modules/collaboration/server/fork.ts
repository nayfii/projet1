import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { canonicalValue } from "@/modules/hide/mask";
import type { HideCategory } from "@/modules/hide/categories";
import { decryptValue, hideConfigured, valueHash } from "@/modules/hide/server/crypto";

/**
 * AUDITED service-role module (docs/ARCHITECTURE.md §5). A transfer forks the conversation
 * (transfer_conversation, CLAUDE.md §11): SQL copies the messages and sources into the sender's own
 * copy; this copies what SQL cannot — the attached files (storage objects, so each branch can be
 * deleted on its own) and the Hide values (their hashes depend on the conversation).
 * Called only by transferConversationAction, right after the RPC succeeded for the signed-in owner.
 * Logs metadata only.
 */
export async function completeFork(input: { from: string; copy: string; messages: Record<string, string> }): Promise<void> {
  const admin = createAdminClient();
  const messageIds = Object.keys(input.messages);

  if (messageIds.length > 0) {
    const { data: files } = await admin
      .from("conversation_attachments")
      .select("message_id, uploaded_by, filename, mime_type, size_bytes, storage_path, kind, extracted_text, text_truncated, masked_text, bucket, media")
      .eq("conversation_id", input.from)
      .in("message_id", messageIds);
    for (const f of files ?? []) {
      const ext = f.storage_path.includes(".") ? f.storage_path.slice(f.storage_path.lastIndexOf(".") + 1) : "bin";
      const path = `${input.copy}/${randomUUID()}.${ext}`;
      const copied = await admin.storage.from(f.bucket).copy(f.storage_path, path);
      if (copied.error) {
        console.error("fork: attachment copy failed", { conversation: input.copy });
        continue;
      }
      const { error } = await admin.from("conversation_attachments").insert({
        conversation_id: input.copy,
        message_id: f.message_id ? input.messages[f.message_id] : null,
        uploaded_by: f.uploaded_by,
        filename: f.filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        storage_path: path,
        kind: f.kind,
        extracted_text: f.extracted_text,
        text_truncated: f.text_truncated,
        masked_text: f.masked_text,
        bucket: f.bucket,
        media: f.media,
      });
      if (error) console.error("fork: attachment row failed", { code: error.code });
    }
  }

  if (!hideConfigured()) return;
  const { data: mappings } = await admin
    .from("hide_mappings")
    .select("company_id, category, placeholder, value_ciphertext")
    .eq("conversation_id", input.from);
  const rows = (mappings ?? []).flatMap((m) => {
    try {
      const plain = decryptValue(m.value_ciphertext);
      return [
        {
          company_id: m.company_id,
          conversation_id: input.copy,
          category: m.category,
          placeholder: m.placeholder,
          value_hash: valueHash(input.copy, m.category, canonicalValue(m.category as HideCategory, plain)),
          value_ciphertext: m.value_ciphertext,
        },
      ];
    } catch {
      return [];
    }
  });
  if (rows.length > 0) {
    const { error } = await admin.from("hide_mappings").insert(rows);
    if (error) console.error("fork: hide mappings failed", { code: error.code });
  }
}
