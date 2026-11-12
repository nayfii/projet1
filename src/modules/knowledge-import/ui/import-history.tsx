"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ImportSummary } from "../server/queries";
import { deleteImportAction } from "../server/actions";

/** Past imports: what was found, left out as private, proposed and kept. Each can be deleted. */
export function ImportHistory({ history, reviewId }: { history: ImportSummary[]; reviewId: string | null }) {
  const t = useTranslations("knowledgeImport");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [deleting, setDeleting] = React.useState<ImportSummary | null>(null);
  const [removeSaved, setRemoveSaved] = React.useState(true);
  const [pending, startTransition] = React.useTransition();

  if (history.length === 0) return null;
  return (
    <section className="space-y-2.5" aria-labelledby="import-history">
      <h2 id="import-history" className="text-sm font-medium">
        {t("historyTitle")}
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="import-history">
        {history.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {t(`source.${h.source as "chatgpt"}`)}
                <Badge variant="outline">{h.status === "analyzing" ? t("status.interrupted") : h.pending > 0 ? t("status.review", { count: h.pending }) : t("status.done")}</Badge>
              </p>
              <p className="truncate text-xs text-muted-foreground" title={h.fileName}>
                {format.dateTime(new Date(h.createdAt), { dateStyle: "medium" })} · {h.fileName}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="import-summary">
                {t("summary", { found: h.found, analyzed: h.analyzed, excluded: h.excludedPrivate, duplicates: h.duplicates, proposed: h.proposed, saved: h.saved })}
              </p>
            </div>
            {h.pending > 0 && h.id !== reviewId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/memory/import?import=${h.id}`}>{t("reviewNow")}</Link>
              </Button>
            ) : null}
            <Button variant="ghost" size="icon-sm" aria-label={t("deleteImport")} onClick={() => setDeleting(h)}>
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("historyHint")}</p>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          {deleting && deleting.saved > 0 ? (
            <div className="flex items-start gap-2">
              <Checkbox id="remove-saved" checked={removeSaved} onCheckedChange={(v) => setRemoveSaved(v === true)} className="mt-0.5" />
              <Label htmlFor="remove-saved" className="text-sm font-normal leading-snug">
                {t("deleteSaved", { count: deleting.saved })}
              </Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  if (!deleting) return;
                  const result = await deleteImportAction({ importId: deleting.id, removeSaved: removeSaved && deleting.saved > 0 });
                  if (!result.ok) toast.error(tErrors(result.error));
                  else toast.success(t("deleted", { count: result.data!.removed }));
                  setDeleting(null);
                  router.refresh();
                })
              }
            >
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
