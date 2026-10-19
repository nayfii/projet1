"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRightLeftIcon, TriangleAlertIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { transferClientAction, transferConversationAction } from "../server/actions";
import type { Colleague } from "../server/queries";
import { HistoryWarnings, useHistoryWarnings } from "./people";

/**
 * Transfer a conversation or a restricted client to a colleague, after confirmation. The AI drafts a
 * handover file for the recipient meanwhile; the sender loses access once it is done.
 */
export function TransferDialog({
  open,
  onOpenChange,
  target,
  colleagues,
  onTransferred,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { kind: "conversation"; id: string } | { kind: "client"; id: string; name: string };
  colleagues: Colleague[];
  onTransferred: () => void;
}) {
  const t = useTranslations("collaboration");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [to, setTo] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const recipient = colleagues.find((c) => c.userId === to) ?? null;
  // The recipient sees the whole conversation: warn if it cites memories they cannot read.
  const { warnings, checking } = useHistoryWarnings(target.id, to ? [to] : [], 1, open && target.kind === "conversation");

  async function submit() {
    if (!recipient) return;
    setRunning(true);
    const result =
      target.kind === "conversation"
        ? await transferConversationAction({ conversationId: target.id, toUserId: recipient.userId })
        : await transferClientAction({ clientId: target.id, toUserId: recipient.userId });
    setRunning(false);
    if (!result.ok) {
      toast.error(tErrors(result.error));
      return;
    }
    toast.success(result.data?.aiGenerated ? t("transferDone", { name: recipient.name }) : t("transferDoneNoAi", { name: recipient.name }));
    onOpenChange(false);
    onTransferred();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The transfer cannot be interrupted once started.
        if (running) return;
        if (!next) setTo(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{target.kind === "conversation" ? t("transferTitle") : t("transferClientTitle", { client: target.name })}</DialogTitle>
          <DialogDescription>{target.kind === "conversation" ? t("transferBody") : t("transferClientBody")}</DialogDescription>
        </DialogHeader>

        {colleagues.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("noRecipients")}</p>
        ) : (
          <fieldset className="space-y-1" disabled={running}>
            <legend className="mb-1 text-sm font-medium">{t("transferTo")}</legend>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {colleagues.map((c) => (
                <label
                  key={c.userId}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50", to === c.userId && "bg-brand-soft/60")}
                >
                  <input type="radio" name="transfer-to" className="accent-[var(--brand)]" checked={to === c.userId} onChange={() => setTo(c.userId)} />
                  <Avatar name={c.name} src={c.avatarUrl} className="size-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{c.name}</span>
                    {c.expertise.length ? <span className="block truncate text-xs text-muted-foreground">{c.expertise.join(", ")}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <HistoryWarnings warnings={warnings} people={colleagues} kind="transfer" />
        {recipient ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px]">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            {t("transferWarning")}
          </p>
        ) : null}

        <DialogFooter className="items-center">
          {running ? <p className="mr-auto text-[13px] text-muted-foreground">{t("transferPreparing")}</p> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!recipient || running || checking}>
            {running ? <Spinner /> : <ArrowRightLeftIcon />}
            {warnings.length > 0 ? t("transferAnyway") : t("transferSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
