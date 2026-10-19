import { z } from "zod";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { detectSensitive } from "@/modules/hide/detect";
import { loadDetectionLists } from "@/modules/hide/server/masker";

const schema = z.object({ text: z.string().max(20_000) });

/**
 * Manual mode: where the message being typed looks sensitive, so the input can underline it in red.
 * Runs on our server (company lists included); returns positions and categories only, logs nothing.
 */
export async function POST(request: Request) {
  const ctx = await memberOrNull();
  if (!ctx) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });
  const lists = await loadDetectionLists(await createClient(), ctx);
  return Response.json({ spans: detectSensitive(parsed.data.text, lists) }, { headers: { "Cache-Control": "no-store" } });
}
