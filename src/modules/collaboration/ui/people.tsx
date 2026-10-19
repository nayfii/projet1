"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserPlusIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TimelineMessage } from "@/modules/conversations/types";
import { addParticipantsAction } from "../server/actions";
import type { Colleague, Participant } from "../server/queries";

/** In the conversation header: who takes part (a dot when they are here) and "Ajouter". */
export function ParticipantsBar({ participants, online, onAdd }: { participants: Participant[]; online: Set<string>; onAdd: () => void }) {
  const t = useTranslations("collaboration");
  return (
    <div className="flex items-center gap-1.5">
      {participants.length > 1 ? (
        <Tooltip content={participants.map((p) => p.name).join(", ")}>
          <div className="flex -space-x-1.5" aria-label={t("participants", { count: participants.length })}>
            {participants.slice(0, 5).map((p) => (
              <span key={p.userId} className="relative">
                <Avatar name={p.name} src={p.avatarUrl} className="size-6 ring-2 ring-background" />
                {online.has(p.userId) ? <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-2 ring-background" /> : null}
              </span>
            ))}
            {participants.length > 5 ? (
              <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
                {`+${participants.length - 5}`}
              </span>
            ) : null}
          </div>
        </Tooltip>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onAdd} className="gap-1.5 text-muted-foreground">
        <UserPlusIcon />
        <span className="hidden sm:inline">{t("add")}</span>
      </Button>
    </div>
  );
}

/** "Nathalie écrit…" */
export function TypingLine({ names }: { names: string[] }) {
  const t = useTranslations("collaboration");
  if (names.length === 0) return null;
  return <p className="px-1 text-xs text-muted-foreground">{names.length === 1 ? t("typingOne", { name: names[0] }) : t("typingMany", { count: names.length })}</p>;
}

type HistoryChoice = "now" | "all" | number;

/**
 * Invite colleagues. By default they see the conversation from their arrival; "Partager l'historique"
 * lets the person choose, on the timeline, the first message they will see.
 */
export function AddPeopleDialog({
  open,
  onOpenChange,
  conversationId,
  title,
  colleagues,
  messages,
  preselected,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
  /** Shared with everyone who joins, whatever history they get. */
  title: string | null;
  colleagues: Colleague[];
  messages: TimelineMessage[];
  preselected: string[];
  onAdded: () => void;
}) {
  const t = useTranslations("collaboration");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set(preselected));
  const [history, setHistory] = React.useState<HistoryChoice>("now");
  const [saving, startSaving] = React.useTransition();
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  const key = open ? preselected.join(",") || "open" : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (open) {
      setSelected(new Set(preselected));
      setHistory("now");
    }
  }
  const timeline = messages.filter((m) => m.content && m.id !== "pending-user");

  const submit = () =>
    startSaving(async () => {
      if (!conversationId) return;
      const fromSeq = history === "now" ? null : history === "all" ? (timeline[0]?.seq ?? null) : history;
      const result = await addParticipantsAction({ conversationId, userIds: [...selected], fromSeq });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("added", { count: selected.size }));
      onOpenChange(false);
      onAdded();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
          <DialogDescription>{t("addBody")}</DialogDescription>
        </DialogHeader>
        {colleagues.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("noColleagues")}</p>
        ) : (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">{t("who")}</legend>
            {colleagues.map((c) => (
              <label key={c.userId} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50">
                <Checkbox
                  checked={selected.has(c.userId)}
                  onCheckedChange={(on) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (on === true) next.add(c.userId);
                      else next.delete(c.userId);
                      return next;
                    })
                  }
                  aria-label={c.name}
                />
                <Avatar name={c.name} src={c.avatarUrl} className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.name}</span>
                  {c.expertise.length ? <span className="block truncate text-xs text-muted-foreground">{c.expertise.join(", ")}</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t("historyTitle")}</legend>
          <HistoryOption checked={history === "now"} onSelect={() => setHistory("now")} label={t("historyNow")} hint={t("historyNowHint")} />
          {timeline.length > 0 ? (
            <>
              <HistoryOption checked={history === "all"} onSelect={() => setHistory("all")} label={t("historyAll")} />
              <div className="rounded-lg border">
                <p className="border-b px-3 py-2 text-xs text-muted-foreground">{t("historyFrom")}</p>
                <div className="max-h-56 overflow-y-auto py-1">
                  {timeline.map((m) => (
                    <label key={m.id} className={cn("flex cursor-pointer items-start gap-2.5 px-3 py-1.5 text-[13px] hover:bg-accent/50", history === m.seq && "bg-brand-soft/60")}>
                      <input type="radio" name="history-from" className="mt-1 accent-[var(--brand)]" checked={history === m.seq} onChange={() => setHistory(m.seq)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-muted-foreground">
                          {m.role === "assistant" ? (m.model?.label ?? t("ai")) : (m.author?.name ?? t("someone"))}
                          {" · "}
                          {format.dateTime(new Date(m.createdAt), { dateStyle: "short", timeStyle: "short" })}
                        </span>
                        <span className="line-clamp-1">{m.content}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          {title ? <p className="text-xs text-muted-foreground">{t("titleShared", { title })}</p> : null}
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={submit} disabled={saving || selected.size === 0}>
            {saving ? <Spinner /> : <UserPlusIcon />}
            {t("addSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryOption({ checked, onSelect, label, hint }: { checked: boolean; onSelect: () => void; label: string; hint?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm", checked && "border-brand/40 bg-brand-soft/40")}>
      <input type="radio" name="history" className="mt-1 accent-[var(--brand)]" checked={checked} onChange={onSelect} />
      <span>
        <span className="block">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
