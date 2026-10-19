"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  BookmarkIcon,
  CheckIcon,
  FileTextIcon,
  LightbulbIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DocumentRow, EntryRow, SuggestionRow } from "../server/queries";
import { decideSuggestionAction, deleteDocumentAction, deleteEntryAction, proposePromotionAction } from "../server/actions";
import { EntryDialog } from "./entry-dialog";
import { DocumentUploader } from "./document-uploader";

type Tab = "entries" | "documents" | "suggestions";

export function MemorySpaceView({
  space,
  entries,
  documents,
  suggestions,
}: {
  space: { spaceId: string; kind: "company" | "client"; canWrite: boolean; label: string };
  entries: EntryRow[];
  documents: DocumentRow[];
  suggestions: SuggestionRow[];
}) {
  const t = useTranslations("memory");
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>(suggestions.length > 0 && space.canWrite ? "suggestions" : "entries");
  const [creating, setCreating] = React.useState(false);
  const processing = documents.some((d) => d.status === "processing");

  // Documents are read and indexed on the server after upload: refresh until they are ready.
  React.useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [processing, router]);

  const tabs: { key: Tab; label: string; count: number; show: boolean }[] = [
    { key: "entries", label: t("tabEntries"), count: entries.length, show: true },
    { key: "documents", label: t("tabDocuments"), count: documents.length, show: true },
    { key: "suggestions", label: t("tabSuggestions"), count: suggestions.length, show: suggestions.length > 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist">
          {tabs
            .filter((x) => x.show)
            .map((x) => (
              <button
                key={x.key}
                role="tab"
                aria-selected={tab === x.key}
                onClick={() => setTab(x.key)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors",
                  tab === x.key ? "bg-card font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {x.label}
                <span className="tabular-nums text-muted-foreground">{x.count}</span>
              </button>
            ))}
        </div>
        {space.canWrite ? (
          <div className="flex gap-2">
            {tab === "documents" ? (
              <DocumentUploader spaceId={space.spaceId} onUploaded={() => router.refresh()} />
            ) : (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon />
                {t("newEntry")}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {tab === "entries" ? <EntriesList entries={entries} space={space} onCreate={() => setCreating(true)} /> : null}
      {tab === "documents" ? <DocumentsList documents={documents} canWrite={space.canWrite} spaceId={space.spaceId} /> : null}
      {tab === "suggestions" ? <SuggestionsList suggestions={suggestions} canWrite={space.canWrite} /> : null}

      <EntryDialog
        open={creating}
        onOpenChange={setCreating}
        targets={[{ spaceId: space.spaceId, label: space.label }]}
        initial={{ title: "", content: "", spaceId: space.spaceId }}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

function EntriesList({
  entries,
  space,
  onCreate,
}: {
  entries: EntryRow[];
  space: { spaceId: string; kind: "company" | "client"; canWrite: boolean; label: string };
  onCreate: () => void;
}) {
  const t = useTranslations("memory");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = React.useState<EntryRow | null>(null);
  const [deleting, setDeleting] = React.useState<EntryRow | null>(null);
  const [busy, startBusy] = React.useTransition();
  const [highlight, setHighlight] = React.useState<string | null>(null);

  React.useEffect(() => {
    const id = window.location.hash.replace("#entry-", "");
    if (!id) return;
    const el = document.getElementById(`entry-${id}`);
    el?.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => setHighlight(id), 0);
    return () => clearTimeout(timer);
  }, []);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<BookmarkIcon />}
        title={t("noEntries")}
        description={space.canWrite ? t("noEntriesWriter") : t("noEntriesReader")}
        action={
          space.canWrite ? (
            <Button variant="outline" onClick={onCreate}>
              <PlusIcon />
              {t("newEntry")}
            </Button>
          ) : null
        }
      />
    );
  }

  const promote = (entry: EntryRow) =>
    startBusy(async () => {
      const result = await proposePromotionAction({ entryId: entry.id });
      if (!result.ok) toast.error(t(`taskErrors.${result.error}`));
      else if (result.proposed) toast.success(t("promotionProposed"));
      else toast.info(t("nothingGeneral"));
    });

  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <Card key={e.id} id={`entry-${e.id}`} className={cn("p-5 transition-shadow", highlight === e.id && "ring-2 ring-brand/40")}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{e.title}</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{e.content}</p>
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <SourceBadge entry={e} />
                <span>
                  {t("byOn", { author: e.author ?? t("formerMember"), date: format.dateTime(new Date(e.createdAt), { dateStyle: "medium" }) })}
                </span>
                {e.updatedAt !== e.createdAt && e.editor ? (
                  <span>· {t("editedBy", { editor: e.editor, date: format.dateTime(new Date(e.updatedAt), { dateStyle: "medium" }) })}</span>
                ) : null}
              </p>
            </div>
            {space.canWrite || space.kind === "client" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t("entryActions")} disabled={busy}>
                    {busy ? <Spinner /> : <MoreHorizontalIcon />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {space.canWrite ? (
                    <DropdownMenuItem onSelect={() => setEditing(e)}>
                      <PencilIcon />
                      {t("edit")}
                    </DropdownMenuItem>
                  ) : null}
                  {space.kind === "client" ? (
                    <DropdownMenuItem onSelect={() => promote(e)}>
                      <SparklesIcon />
                      {t("proposePromotion")}
                    </DropdownMenuItem>
                  ) : null}
                  {space.canWrite ? (
                    <DropdownMenuItem destructive onSelect={() => setDeleting(e)}>
                      <Trash2Icon />
                      {t("delete")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </Card>
      ))}

      <EntryDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        targets={[{ spaceId: space.spaceId, label: space.label }]}
        initial={editing ? { title: editing.title, content: editing.content } : undefined}
        entryId={editing?.id}
        onSaved={() => router.refresh()}
      />
      <ConfirmDelete
        open={deleting !== null}
        title={t("deleteEntryTitle")}
        body={t("deleteEntryBody")}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteEntryAction({ entryId: deleting.id });
          if (result.ok) toast.success(t("entryDeleted"));
          else toast.error(tErrors(result.error));
          setDeleting(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function SourceBadge({ entry }: { entry: EntryRow }) {
  const t = useTranslations("memory");
  const label = t(`source.${entry.sourceType}`);
  if (entry.sourceType === "chat" && entry.conversationId) {
    return (
      <Link href={`/chat/${entry.conversationId}`} className="hover:text-foreground">
        <Badge variant="outline">{label}</Badge>
      </Link>
    );
  }
  return <Badge variant={entry.sourceType === "promotion" || entry.sourceType === "ai_suggestion" ? "brand" : "outline"}>{label}</Badge>;
}

function DocumentsList({ documents, canWrite, spaceId }: { documents: DocumentRow[]; canWrite: boolean; spaceId: string }) {
  const t = useTranslations("memory");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [deleting, setDeleting] = React.useState<DocumentRow | null>(null);

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon />}
        title={t("noDocuments")}
        description={canWrite ? t("noDocumentsWriter") : t("noDocumentsReader")}
        action={canWrite ? <DocumentUploader spaceId={spaceId} onUploaded={() => router.refresh()} /> : null}
      />
    );
  }

  return (
    <Card className="divide-y overflow-hidden">
      {documents.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            {d.status === "ready" ? (
              <Link href={`/memory/documents/${d.id}`} className="block truncate text-sm font-medium hover:underline">
                {d.filename}
              </Link>
            ) : (
              <p className="truncate text-sm font-medium">{d.filename}</p>
            )}
            <p className="truncate text-xs text-muted-foreground">
              {t("addedBy", { author: d.uploader ?? t("formerMember"), date: format.dateTime(new Date(d.createdAt), { dateStyle: "medium" }) })}
              {d.pageCount ? ` · ${t("pages", { count: d.pageCount })}` : ""}
            </p>
          </div>
          <DocumentStatus document={d} />
          {canWrite ? (
            <Button variant="ghost" size="icon-sm" aria-label={t("deleteDocument", { name: d.filename })} onClick={() => setDeleting(d)}>
              <Trash2Icon />
            </Button>
          ) : null}
        </div>
      ))}
      <ConfirmDelete
        open={deleting !== null}
        title={t("deleteDocumentTitle")}
        body={t("deleteDocumentBody")}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteDocumentAction({ documentId: deleting.id });
          if (result.ok) toast.success(t("documentDeleted"));
          else toast.error(tErrors(result.error));
          setDeleting(null);
          router.refresh();
        }}
      />
    </Card>
  );
}

function DocumentStatus({ document: d }: { document: DocumentRow }) {
  const t = useTranslations("memory");
  if (d.status === "processing") {
    return (
      <Badge variant="neutral">
        <Spinner className="size-3" />
        {t("statusProcessing")}
      </Badge>
    );
  }
  if (d.status === "failed") {
    return <Badge variant="destructive">{d.errorCode === "no_text" ? t("statusNoText") : t("statusFailed")}</Badge>;
  }
  return (
    <span className="flex items-center gap-1.5">
      {d.truncated ? <Badge variant="warning">{t("partlyIndexed")}</Badge> : null}
      {d.errorCode?.startsWith("words_only") ? <Badge variant="warning">{t("wordsOnly")}</Badge> : null}
      <Badge variant="success">{t("statusReady", { count: d.chunkCount ?? 0 })}</Badge>
    </span>
  );
}

function SuggestionsList({ suggestions, canWrite }: { suggestions: SuggestionRow[]; canWrite: boolean }) {
  const t = useTranslations("memory");
  if (suggestions.length === 0) return <EmptyState icon={<LightbulbIcon />} title={t("noSuggestions")} />;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">{canWrite ? t("suggestionsIntro") : t("suggestionsWaiting")}</p>
      {suggestions.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} canWrite={canWrite} />
      ))}
    </div>
  );
}

export function SuggestionCard({
  suggestion,
  canWrite,
  onDecided,
}: {
  suggestion: { id: string; kind?: "new_entry" | "promotion"; title: string; content: string; proposer?: string | null };
  canWrite: boolean;
  onDecided?: (approved: boolean) => void;
}) {
  const t = useTranslations("memory");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [title, setTitle] = React.useState(suggestion.title);
  const [content, setContent] = React.useState(suggestion.content);
  const [busy, startBusy] = React.useTransition();
  const [done, setDone] = React.useState<null | "approved" | "rejected">(null);

  const decide = (approve: boolean) =>
    startBusy(async () => {
      const result = await decideSuggestionAction({ suggestionId: suggestion.id, approve, title, content });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setDone(approve ? "approved" : "rejected");
      toast.success(approve ? t("suggestionApproved") : t("suggestionRejected"));
      onDecided?.(approve);
      router.refresh();
    });

  return (
    <Card className={cn("space-y-3 p-4", done && "opacity-60")}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="brand">
          <SparklesIcon />
          {suggestion.kind === "promotion" ? t("kindPromotion") : t("kindNewEntry")}
        </Badge>
        {suggestion.proposer ? <span>{t("requestedBy", { name: suggestion.proposer })}</span> : null}
      </div>
      {canWrite && !done ? (
        <>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label={t("entryTitle")} />
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} maxLength={20000} aria-label={t("entryContent")} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => decide(false)}>
              <XIcon />
              {t("reject")}
            </Button>
            <Button size="sm" disabled={busy || !title.trim() || !content.trim()} onClick={() => decide(true)}>
              {busy ? <Spinner /> : <CheckIcon />}
              {t("approve")}
            </Button>
          </div>
        </>
      ) : (
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{content}</p>
          {done ? <p className="mt-2 text-xs text-muted-foreground">{done === "approved" ? t("suggestionApproved") : t("suggestionRejected")}</p> : null}
        </div>
      )}
    </Card>
  );
}

function ConfirmDelete({ open, title, body, onCancel, onConfirm }: { open: boolean; title: string; body: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const tCommon = useTranslations("common");
  const t = useTranslations("memory");
  const [busy, startBusy] = React.useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => startBusy(onConfirm)}>
            {busy ? <Spinner /> : null}
            {t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
