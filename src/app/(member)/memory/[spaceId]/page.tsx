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
import { hasScope } from "@/lib/auth/context";
import { listFactHistory } from "@/modules/memory/server/knowledge";
import { ProviderPolicy } from "@/modules/memory/ui/provider-policy";
import { HistoryIcon } from "lucide-react";

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
  const [entries, documents, suggestions, history] = await Promise.all([listEntries(spaceId), listDocuments(spaceId), listSuggestions(spaceId), listFactHistory(spaceId)]);
  const tc = await getTranslations("consciousness");
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
      {hasScope(ctx.active, "permissions") ? (
        <div className="mb-6">
          <ProviderPolicy spaceId={spaceId} blocked={space.blockedProviders} />
        </div>
      ) : null}
      <MemorySpaceView space={{ spaceId, kind: space.kind, canWrite: space.canWrite, label }} entries={entries} documents={documents} suggestions={suggestions} />
      {history.length > 0 ? (
        <details className="mt-8 rounded-xl border px-4 py-3" data-testid="fact-history">
          <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <HistoryIcon className="size-4" />
            {tc("historyTitle", { count: history.length })}
          </summary>
          <ul className="mt-3 space-y-2">
            {history.map((h) => (
              <li key={h.id} className="text-[13px] leading-snug">
                <span className="text-muted-foreground line-through">{h.before}</span>
                {h.after ? <span className="ml-2">{"→ "}{h.after}</span> : null}
                <span className="ml-2 text-[11.5px] text-muted-foreground">{new Date(h.at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </PageContainer>
  );
}
