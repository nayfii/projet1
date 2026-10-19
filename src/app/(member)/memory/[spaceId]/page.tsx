import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { listDocuments, listEntries, listMemorySpaces, listSuggestions } from "@/modules/memory/server/queries";
import { MemorySpaceView } from "@/modules/memory/ui/memory-space-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory");
  return { title: t("title") };
}

export default async function MemorySpacePage({ params }: PageProps<"/memory/[spaceId]">) {
  const ctx = await requireMember();
  const { spaceId } = await params;
  const t = await getTranslations("memory");
  // Only memories the user can read are listed: anything else is a 404 that does not confirm it exists.
  const space = (await listMemorySpaces(ctx)).find((s) => s.spaceId === spaceId);
  if (!space) notFound();
  const [entries, documents, suggestions] = await Promise.all([listEntries(spaceId), listDocuments(spaceId), listSuggestions(spaceId)]);
  const label = space.kind === "company" ? t("companyMemory") : t("clientMemoryNamed", { client: space.clientName ?? "" });

  return (
    <PageContainer className="max-w-4xl">
      <Link href="/memory" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        {t("title")}
      </Link>
      <PageHeader
        title={label}
        description={space.kind === "company" ? t("companyMemoryBody") : t("clientMemoryBody")}
        actions={!space.canWrite ? <Badge variant="outline">{t("readOnly")}</Badge> : null}
      />
      <MemorySpaceView space={{ spaceId, kind: space.kind, canWrite: space.canWrite, label }} entries={entries} documents={documents} suggestions={suggestions} />
    </PageContainer>
  );
}
