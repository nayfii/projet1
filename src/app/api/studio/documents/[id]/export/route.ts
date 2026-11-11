import { getTranslations } from "next-intl/server";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { markdownToBlocks } from "@/modules/exports/blocks";
import { toDocx, toPdf } from "@/modules/exports/server/render";
import { blocksToMarkdown, linkedDocumentIds, type Block } from "@/modules/studio/logic/blocks";

export const runtime = "nodejs";

const TYPES = {
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/** A Knowledge document as Markdown, Word or PDF (built on our server, with the existing export tools). */
export async function GET(request: Request, ctx: RouteContext<"/api/studio/documents/[id]/export">) {
  if (!(await platformAdminOrNull())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") as keyof typeof TYPES | null;
  if (!format || !(format in TYPES) || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "validation" }, { status: 400 });
  const supabase = await createClient();
  const { data: doc } = await supabase.from("scale_documents").select("title, content").eq("id", id).maybeSingle();
  if (!doc) return Response.json({ error: "not_found" }, { status: 404 });
  const blocks = (doc.content ?? []) as unknown as Block[];
  // Links to other documents are written with their current titles.
  const linked = linkedDocumentIds(blocks);
  const { data: others } = linked.length ? await supabase.from("scale_documents").select("id, title").in("id", linked) : { data: [] };
  const titles = new Map((others ?? []).map((o) => [o.id, o.title]));
  const t = await getTranslations("studio.editor.kinds");
  const markdown = blocksToMarkdown(doc.title, blocks, { hypothesis: t("hypothesis"), fact: t("fact"), decision: t("decision"), image: t("image") }, (docId) => titles.get(docId) ?? null);
  const base = doc.title.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase() || "document";
  let body: Buffer | string = markdown;
  if (format === "docx") body = await toDocx(doc.title, markdownToBlocks(markdown.replace(/^# .*\n+/, "")));
  if (format === "pdf") body = await toPdf(doc.title, markdownToBlocks(markdown.replace(/^# .*\n+/, "")));
  return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body, "utf8") : body), {
    headers: { "Content-Type": TYPES[format], "Content-Disposition": `attachment; filename="${base}.${format}"`, "Cache-Control": "no-store" },
  });
}
