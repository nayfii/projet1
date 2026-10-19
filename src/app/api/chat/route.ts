import { after } from "next/server";
import { memberOrNull } from "@/lib/auth/guards";
import { chatRequestSchema, prepareChatTurn } from "@/modules/conversations/server/chat-service";
import type { ChatStreamEvent } from "@/modules/conversations/stream-events";

// Long answers can take a while; the platform default may be shorter.
export const maxDuration = 300;

/**
 * Sends a message (or regenerates the last answer) and streams the answer as NDJSON.
 * Authorisation: active member (here), conversation participant (RLS), model rules and quotas
 * (prepareChatTurn). Nothing reaches a provider before all of these pass.
 */
export async function POST(request: Request) {
  const ctx = await memberOrNull();
  if (!ctx) return Response.json({ error: "forbidden" }, { status: 403 });

  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

  const prepared = await prepareChatTurn(ctx, parsed.data);
  if (!prepared.ok) return Response.json({ error: prepared.error }, { status: prepared.status });

  const encoder = new TextEncoder();
  let task: Promise<void> = Promise.resolve();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The browser went away (reload, closed tab): the answer keeps being written and saved.
        }
      };
      task = (async () => {
        try {
          for await (const event of prepared.run()) send(event);
        } catch {
          send({ type: "error", code: "server_error", retryable: true });
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      })();
    },
  });
  // Saving the answer and the usage must finish even if the browser disconnects.
  after(() => task);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
