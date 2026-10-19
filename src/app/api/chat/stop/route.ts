import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { requestStop } from "@/modules/conversations/server/assistant-writer";

/** Stop button: asks the server to stop writing an answer. RLS proves the user takes part in the conversation. */
export async function POST(request: Request) {
  const ctx = await memberOrNull();
  if (!ctx) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = z.object({ messageId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select("id, conversation_id")
    .eq("id", parsed.data.messageId)
    .eq("author_type", "assistant")
    .maybeSingle();
  if (!message) return Response.json({ error: "not_found" }, { status: 404 });
  const stopped = await requestStop(message.id, message.conversation_id);
  return Response.json({ ok: true, stopped });
}
