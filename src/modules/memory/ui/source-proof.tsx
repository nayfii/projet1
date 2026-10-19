"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { BookmarkIcon, ExternalLinkIcon, FileTextIcon, XIcon } from "lucide-react";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { SourceProof } from "../types";

/** Where a source comes from, in words: "Company memory" or "Client memory · Client A". */
export function useSourceOrigin() {
  const t = useTranslations("sources");
  return (s: Pick<SourceProof, "spaceKind" | "clientName">) =>
    s.spaceKind === "company" ? t("companyMemory") : s.clientName ? t("clientMemoryNamed", { client: s.clientName }) : t("clientMemory");
}

/** Source Proof under an answer: each cited passage, with its origin and date, opening the exact passage. */
export function SourceList({ sources, onOpen }: { sources: SourceProof[]; onOpen: (position: number) => void }) {
  const t = useTranslations("sources");
  const format = useFormatter();
  const origin = useSourceOrigin();
  if (sources.length === 0) return null;
  return (
    <section aria-label={t("title")} className="space-y-1.5 pt-1">
      <p className="text-xs font-medium text-muted-foreground">{t("title")}</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {sources.map((s) => (
          <button
            key={s.position}
            type="button"
            onClick={() => onOpen(s.position)}
            className="group flex min-w-0 items-start gap-2.5 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-foreground/20"
          >
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-brand-soft text-[10px] font-semibold text-brand">
              {s.position}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                {s.sourceType === "document_chunk" ? <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <BookmarkIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{s.title}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{s.excerpt}</span>
              <span className="mt-1 block truncate text-[11px] text-muted-foreground/80">
                {origin(s)}
                {s.page ? ` · ${t("page", { page: s.page })}` : ""}
                {s.sourceDate ? ` · ${format.dateTime(new Date(s.sourceDate), { dateStyle: "medium" })}` : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Side panel with the exact passage, its origin and date, and a link to the full document or memory. */
export function SourceSheet({ source, onClose }: { source: SourceProof | null; onClose: () => void }) {
  const t = useTranslations("sources");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const origin = useSourceOrigin();
  const href = source
    ? source.sourceType === "document_chunk" && source.documentId
      ? `/memory/documents/${source.documentId}${source.charStart !== null ? `?from=${source.charStart}&to=${source.charEnd}` : ""}`
      : source.spaceId
        ? `/memory/${source.spaceId}${source.entryId ? `#entry-${source.entryId}` : ""}`
        : null
    : null;

  return (
    <Sheet open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" title={t("passageTitle")}>
        {source ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start gap-3 border-b px-5 py-4">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-brand-soft text-xs font-semibold text-brand">
                {source.position}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{source.title}</p>
                <p className="text-xs text-muted-foreground">
                  {source.sourceType === "document_chunk" ? t("document") : t("entry")} · {origin(source)}
                  {source.page ? ` · ${t("page", { page: source.page })}` : ""}
                </p>
                {source.sourceDate ? (
                  <p className="text-xs text-muted-foreground">{t("dated", { date: format.dateTime(new Date(source.sourceDate), { dateStyle: "long" }) })}</p>
                ) : null}
              </div>
              <SheetClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label={tCommon("close")}>
                  <XIcon />
                </Button>
              </SheetClose>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t("exactPassage")}</p>
              <blockquote className="whitespace-pre-wrap rounded-lg border-l-2 border-brand bg-brand-soft/40 px-4 py-3 text-sm leading-relaxed">
                {source.excerpt}
              </blockquote>
            </div>
            {href ? (
              <div className="border-t px-5 py-4">
                <Button asChild variant="outline" className="w-full">
                  <Link href={href}>
                    <ExternalLinkIcon />
                    {source.sourceType === "document_chunk" ? t("openDocument") : t("openEntry")}
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
