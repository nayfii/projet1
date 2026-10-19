import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { getDocument } from "@/modules/memory/server/queries";
import { DocumentText } from "@/modules/memory/ui/document-text";

export async function generateMetadata({ params }: PageProps<"/memory/documents/[id]">): Promise<Metadata> {
  const { id } = await params;
  const doc = /^[0-9a-f-]{36}$/i.test(id) ? await getDocument(id) : null;
  return { title: doc?.filename };
}

/** A memory document's text, with the passage cited by an answer highlighted (?from=&to=). */
export default async function DocumentPage({ params, searchParams }: PageProps<"/memory/documents/[id]">) {
  const ctx = await requireMember();
  const { id } = await params;
  const { from, to } = await searchParams;
  const t = await getTranslations("memory");
  const format = await getFormatter();
  const doc = /^[0-9a-f-]{36}$/i.test(id) ? await getDocument(id) : null;
  if (!doc || doc.company_id !== ctx.active.companyId) notFound();
  const start = Number(from);
  const end = Number(to);
  const highlight = Number.isInteger(start) && Number.isInteger(end) && end > start ? { start, end } : null;

  return (
    <PageContainer className="max-w-3xl">
      <Link href={`/memory/${doc.space_id}`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        {t("backToMemory")}
      </Link>
      <PageHeader
        title={doc.filename}
        description={t("addedBy", {
          author: doc.uploader?.full_name ?? doc.uploader?.email ?? t("formerMember"),
          date: format.dateTime(new Date(doc.created_at), { dateStyle: "long" }),
        })}
        actions={
          <Button asChild variant="outline">
            <a href={`/api/documents/${doc.id}/file`}>
              <DownloadIcon />
              {t("downloadOriginal")}
            </a>
          </Button>
        }
      />
      {doc.text_truncated ? <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-[13px]">{t("truncatedNotice")}</p> : null}
      <DocumentText text={doc.extracted_text ?? ""} highlight={highlight} />
    </PageContainer>
  );
}
