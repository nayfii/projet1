"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ScaleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ModelName } from "@/modules/conversations/ui/provider-mark";
import { modelDisplay } from "@/modules/providers/catalog";
import { estimateConfrontationAction, type ConfrontEstimate } from "../server/actions";

/**
 * Before running Confronter: which models take part, who writes the synthesis and the credit cost
 * (several times a normal question). Nothing is sent until the person confirms.
 */
export function ConfrontDialog({
  target,
  onOpenChange,
  onRun,
}: {
  /** The question to confront; null closes the dialog. */
  target: { conversationId: string; messageId: string; excerpt: string } | null;
  onOpenChange: (open: boolean) => void;
  onRun: (estimate: Extract<ConfrontEstimate, { ok: true }>) => void;
}) {
  const t = useTranslations("confronter");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [estimate, setEstimate] = React.useState<{ key: string; value: ConfrontEstimate } | null>(null);
  const key = target ? `${target.conversationId}:${target.messageId}` : null;

  React.useEffect(() => {
    if (!key) return;
    const [conversationId, messageId] = key.split(":");
    let cancelled = false;
    void estimateConfrontationAction({ conversationId, messageId }).then((value) => {
      if (!cancelled) setEstimate({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = estimate && estimate.key === key ? estimate.value : null;
  const credits = (n: number) => format.number(n, { maximumFractionDigits: 0 });

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScaleIcon className="size-4 text-brand" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {target ? <p className="line-clamp-2 rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground">{`« ${target.excerpt} »`}</p> : null}

        {!current ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Spinner />
            {t("estimating")}
          </div>
        ) : !current.ok ? (
          <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-[13px]">
            {t(`unavailable.${current.reason}`)}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{t("participants")}</p>
              {current.models.map((m) => (
                <div key={m.id} className="text-sm">
                  <ModelName provider={m.provider} label={m.label} />
                </div>
              ))}
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-[13px] text-muted-foreground">
              <li>{t("stepAnswer")}</li>
              <li>{t("stepCritique")}</li>
              <li>{t("stepSynthesis", { model: modelDisplay(current.judge.provider, current.judge.label).brand })}</li>
            </ol>
            <div className="rounded-lg border px-3 py-2.5">
              <p className="text-sm font-medium">{t("cost", { credits: credits(current.credits) })}</p>
              <p className="text-xs text-muted-foreground">{t("costHint", { times: Math.max(2, Math.round(current.credits / current.single)), single: credits(current.single) })}</p>
              {Number.isFinite(current.remaining) ? (
                <p className="mt-1 text-xs text-muted-foreground">{t("remaining", { credits: credits(current.remaining) })}</p>
              ) : null}
            </div>
            {!current.enough ? (
              <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-[13px]">
                {t("notEnough")}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button variant="brand" disabled={!current?.ok || !current.enough} onClick={() => current?.ok && onRun(current)}>
            <ScaleIcon />
            {current?.ok ? t("run", { credits: credits(current.credits) }) : t("runPlain")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
