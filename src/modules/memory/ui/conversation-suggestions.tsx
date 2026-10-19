"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { LightbulbIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/form";
import { suggestFromConversationAction, type SuggestionResult } from "../server/actions";
import { SuggestionCard } from "./memory-space-view";

/**
 * "Propose memory entries": the AI reads the conversation and proposes entries; the person approves,
 * edits or rejects each one. Nothing is saved without approval (no silent capture).
 */
export function ConversationSuggestions({ open, onOpenChange, conversationId }: { open: boolean; onOpenChange: (open: boolean) => void; conversationId: string }) {
  const t = useTranslations("memory");
  const tCommon = useTranslations("common");
  const [result, setResult] = React.useState<SuggestionResult | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    suggestFromConversationAction({ conversationId }).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
      setResult(null);
    };
  }, [open, conversationId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("suggestTitle")}</DialogTitle>
          <DialogDescription>{t("suggestBody")}</DialogDescription>
        </DialogHeader>
        {result === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner />
            {t("suggestLoading")}
          </div>
        ) : !result.ok ? (
          <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
            {t(`taskErrors.${result.error}`)}
          </p>
        ) : result.suggestions.length === 0 ? (
          <EmptyState icon={<LightbulbIcon />} title={t("suggestNone")} />
        ) : (
          <div className="space-y-3">
            {result.suggestions.map((s) => (
              <SuggestionCard key={s.id} suggestion={{ ...s, kind: "new_entry" }} canWrite />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
