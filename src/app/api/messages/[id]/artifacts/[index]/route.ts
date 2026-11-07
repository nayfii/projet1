import { getLocale, getTranslations } from "next-intl/server";
import { memberOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { artifactsIn, codeExtension } from "@/modules/artifacts/parse";
import { markdownToBlocks, tablesOf } from "@/modules/exports/blocks";
import { toCsv, toDocx, toPdf, toXlsx } from "@/modules/exports/server/render";

export const runtime = "nodejs";

const TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown; charset=utf-8",
  code: "text/plain; charset=utf-8",
} as const;
type Format = keyof typeof TYPES;

/** Which downloads each kind of artifact offers. */
const ALLOWED: Record<string, Format[]> = {
  document: ["pdf", "docx", "md"],
  slides: ["pdf", "md"],
  sheet: ["xlsx", "csv"],
  code: ["code"],
};

/**
 * Downloads one artifact (the n-th of a message, by the AI or a person's edit) as PDF, Word, Excel,
 * CSV, Markdown or its code file. RLS decides whether the person may read the message; the file is
 * built on our server from the artifact only.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/messages/[id]/artifacts/[index]">) {
  const member = await memberOrNull();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id, index } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") as Format | null;
  const n = Number(index);
  if (!format || !(format in TYPES) || !/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(n) || n < 0 || n > 50) {
    return Response.json({ error: "validation" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: message } = await supabase.from("messages").select("content").eq("id", id).maybeSingle();
  const artifact = message ? artifactsIn(message.content)[n] : undefined;
  if (!artifact) return Response.json({ error: "not_found" }, { status: 404 });
  if (!ALLOWED[artifact.kind].includes(format)) return Response.json({ error: "validation" }, { status: 400 });

  const t = await getTranslations("exports");
  const base = (artifact.title.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document").toLowerCase();
  const blocks = markdownToBlocks(artifact.body);
  let body: Buffer | string;
  let extension: string = format;
  if (format === "docx") body = await toDocx(artifact.title, blocks);
  else if (format === "pdf") body = await toPdf(artifact.title, blocks, { slides: artifact.kind === "slides" });
  else if (format === "md") body = `${artifact.body}\n`;
  else if (format === "code") {
    body = `${artifact.body}\n`;
    extension = codeExtension(artifact.lang);
  } else {
    if (tablesOf(blocks).length === 0) return Response.json({ error: "no_table" }, { status: 404 });
    body = format === "csv" ? toCsv(blocks, (await getLocale()) === "fr" ? ";" : ",") : await toXlsx(blocks, (i) => t("sheet", { number: i + 1 }));
  }
  return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body, "utf8") : body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${base}.${extension}"`,
      "Cache-Control": "no-store",
    },
  });
}
