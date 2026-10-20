import { getLocale, getTranslations } from "next-intl/server";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { markdownToBlocks, tablesOf } from "@/modules/exports/blocks";
import { titleOf, toCsv, toDocx, toPdf, toXlsx } from "@/modules/exports/server/render";

export const runtime = "nodejs";

const FORMATS = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/**
 * Downloads an AI answer as Word, PDF, CSV or Excel. RLS decides whether the person may read the
 * message (participant, from their starting point in a group); the file is built on our server.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/messages/[id]/export">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") as keyof typeof FORMATS | null;
  if (!format || !(format in FORMATS) || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "validation" }, { status: 400 });

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select("content, author_type, status, conversation:conversations(title)")
    .eq("id", id)
    .maybeSingle();
  if (!message || message.author_type !== "assistant" || !message.content.trim()) return Response.json({ error: "not_found" }, { status: 404 });

  const t = await getTranslations("exports");
  const blocks = markdownToBlocks(message.content);
  const fallback = message.conversation?.title?.trim() || t("defaultTitle");
  const title = titleOf(blocks, fallback);
  const base = (title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export").toLowerCase();

  let body: Buffer | string;
  if (format === "docx") body = await toDocx(title, blocks);
  else if (format === "pdf") body = await toPdf(title, blocks);
  else {
    if (tablesOf(blocks).length === 0) return Response.json({ error: "no_table" }, { status: 404 });
    body = format === "csv" ? toCsv(blocks, (await getLocale()) === "fr" ? ";" : ",") : await toXlsx(blocks, (i) => t("sheet", { number: i + 1 }));
  }
  return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body, "utf8") : body), {
    headers: {
      "Content-Type": FORMATS[format],
      "Content-Disposition": `attachment; filename="${base}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
