"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { TriangleAlertIcon, UserMinusIcon, UserPlusIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ColleaguePicker } from "./colleague-picker";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TimelineMessage } from "@/modules/conversations/types";
import { addParticipantsAction, checkSharedHistoryAction, removeParticipantAction, setParticipantRightAction, type HistoryWarning } from "../server/actions";
import { PARTICIPANT_RIGHTS, type ParticipantRight } from "../rights";
import type { Colleague, Participant } from "../server/queries";

/**
 * In the conversation header: who takes part (a dot when they are here). A click opens the list of
 * people and their rights; "Ajouter" only for those who may manage participants.
 */
export function ParticipantsBar({
  participants,
  online,
  onAdd,
  canManage,
  conversationId,
  meId,
  onChanged,
}: {
  participants: Participant[];
  online: Set<string>;
  onAdd: () => void;
  canManage: boolean;
  conversationId: string | null;
  meId: string;
  onChanged: () => void;
}) {
  const t = useTranslations("collaboration");
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex items-center gap-1.5">
      {participants.length > 1 ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded-full" aria-label={t("participants", { count: participants.length })}>
          <span className="flex -space-x-1">
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
          </span>
        </button>
      ) : null}
      {canManage ? (
        <Button variant="ghost" size="sm" onClick={onAdd} className="gap-1.5 text-muted-foreground">
          <UserPlusIcon />
          <span className="hidden sm:inline">{t("add")}</span>
        </Button>
      ) : null}
      <PeopleDialog
        open={open}
        onOpenChange={setOpen}
        participants={participants}
        online={online}
        canManage={canManage}
        conversationId={conversationId}
        meId={meId}
        onChanged={onChanged}
      />
    </div>
  );
}

/** Who is here and with which right; managers and the owner change rights or remove someone. */
function PeopleDialog({
  open,
  onOpenChange,
  participants,
  online,
  canManage,
  conversationId,
  meId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participants: Participant[];
  online: Set<string>;
  canManage: boolean;
  conversationId: string | null;
  meId: string;
  onChanged: () => void;
}) {
  const t = useTranslations("collaboration");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [busy, startBusy] = React.useTransition();
  const [removing, setRemoving] = React.useState<Participant | null>(null);
  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startBusy(async () => {
      const result = await action();
      if (!result.ok) toast.error(tErrors((result.error ?? "unknown") as "unknown"));
      else onChanged();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("peopleTitle")}</DialogTitle>
          <DialogDescription>{t("peopleBody")}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {participants.map((p) => (
            <li key={p.userId} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <span className="relative">
                <Avatar name={p.name} src={p.avatarUrl} className="size-8" />
                {online.has(p.userId) ? <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-popover" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {p.name}
                {p.userId === meId ? <span className="text-muted-foreground">{` · ${t("you")}`}</span> : null}
              </span>
              {p.role === "owner" || !canManage || !conversationId || p.userId === meId ? (
                <span className="text-xs text-muted-foreground">{t(`right.${p.role}`)}</span>
              ) : (
                <>
                  <select
                    aria-label={t("rightOf", { name: p.name })}
                    value={p.role}
                    disabled={busy}
                    onChange={(e) => run(() => setParticipantRightAction({ conversationId, userId: p.userId, role: e.target.value as ParticipantRight }))}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                  >
                    {PARTICIPANT_RIGHTS.map((r) => (
                      <option key={r} value={r}>
                        {t(`right.${r}`)}
                      </option>
                    ))}
                  </select>
                  <Button variant="ghost" size="icon-sm" aria-label={t("removePerson", { name: p.name })} disabled={busy} onClick={() => setRemoving(p)}>
                    <UserMinusIcon />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {removing && conversationId ? (
          <div role="alertdialog" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive-soft/50 p-3 text-sm">
            <p>{t("removeConfirm", { name: removing.name })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
                {tCommon("cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const who = removing;
                  setRemoving(null);
                  run(() => removeParticipantAction({ conversationId, userId: who.userId }));
                }}
              >
                {t("remove")}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** "Nathalie écrit…" */
export function TypingLine({ names }: { names: string[] }) {
  const t = useTranslations("collaboration");
  if (names.length === 0) return null;
  return <p className="px-1 text-xs text-muted-foreground">{names.length === 1 ? t("typingOne", { name: names[0] }) : t("typingMany", { count: names.length })}</p>;
}

type HistoryChoice = "now" | "all" | number;

/** Memories cited in the history about to be shared that some recipients cannot read (checked on the server). */
export function useHistoryWarnings(conversationId: string | null, userIds: string[], fromSeq: number | null, enabled: boolean) {
  const key = enabled && conversationId && userIds.length > 0 ? JSON.stringify({ conversationId, userIds, fromSeq }) : null;
  const [result, setResult] = React.useState<{ key: string; warnings: HistoryWarning[] } | null>(null);
  React.useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void checkSharedHistoryAction(JSON.parse(key)).then((warnings) => {
      if (!cancelled) setResult({ key, warnings });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return { warnings: key && result?.key === key ? result.warnings : [], checking: key !== null && result?.key !== key };
}

export function HistoryWarnings({ warnings, people, kind }: { warnings: HistoryWarning[]; people: { userId: string; name: string }[]; kind: "share" | "transfer" }) {
  const t = useTranslations("collaboration");
  if (warnings.length === 0) return null;
  return (
    <div role="alert" className="space-y-1 rounded-lg bg-warning-soft px-3 py-2 text-[13px]">
      {warnings.map((w) => {
        const memory = w.clientName ? t("clientMemory", { client: w.clientName }) : t("companyMemory");
        const names = w.userIds.map((id) => people.find((p) => p.userId === id)?.name ?? "?").join(", ");
        return (
          <p key={`${w.clientName}-${names}`} className="flex items-start gap-2">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            {kind === "share" ? t("historyWarning", { memory, names, count: w.userIds.length }) : t("transferWarningMemory", { memory, names })}
          </p>
        );
      })}
      {kind === "share" ? <p className="pl-6 text-muted-foreground">{t("historyWarningHint")}</p> : null}
    </div>
  );
}

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
  const [right, setRight] = React.useState<ParticipantRight>("participant");
  const [saving, startSaving] = React.useTransition();
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  const key = open ? preselected.join(",") || "open" : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (open) {
      setSelected(new Set(preselected));
      setHistory("now");
      setRight("participant");
    }
  }
  const timeline = messages.filter((m) => m.content && m.id !== "pending-user");
  const fromSeq = history === "now" ? null : history === "all" ? (timeline[0]?.seq ?? null) : history;
  const { warnings, checking } = useHistoryWarnings(conversationId, [...selected], fromSeq, open && fromSeq !== null);

  const submit = () =>
    startSaving(async () => {
      if (!conversationId) return;
      const result = await addParticipantsAction({ conversationId, userIds: [...selected], fromSeq, role: right });
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
          <ColleaguePicker colleagues={colleagues} selected={selected} onChange={setSelected} label={t("who")} />
        )}

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t("rightTitle")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {PARTICIPANT_RIGHTS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={right === r}
                onClick={() => setRight(r)}
                className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors", right === r ? "border-brand/50 bg-brand-soft" : "hover:bg-accent")}
              >
                <span className="block font-medium">{t(`right.${r}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`rightHint.${r}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t("historyTitle")}</legend>
          <HistoryOption checked={history === "now"} onSelect={() => setHistory("now")} label={t("historyNow")} hint={t("historyNowHint")} />
          {timeline.length > 0 ? (
            <>
              <HistoryOption checked={history === "all"} onSelect={() => setHistory("all")} label={t("historyAll")} />
              <div className="rounded-lg border">
                <p className="border-b px-3 py-2 text-xs text-muted-foreground">{t("historyFrom")}</p>
                <div className="max-h-44 overflow-y-auto py-1">
                  {timeline.map((m) => (
                    <label key={m.id} className={cn("flex cursor-pointer items-start gap-2.5 px-3 py-1.5 text-[13px] hover:bg-accent/50", history === m.seq && "bg-brand-soft/60")}>
                      <input type="radio" name="history-from" className="mt-1 accent-[var(--brand)]" checked={history === m.seq} onChange={() => setHistory(m.seq)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-muted-foreground">
                          {m.role === "assistant" ? (m.model?.label ?? t("ai")) : (m.author?.name ?? t("someone"))}
                          {" · "}
                          {format.dateTime(new Date(m.createdAt), { dateStyle: "short", timeStyle: "short" })}
                        </span>
                        <span className="line-clamp-1">{plainPreview(m.content)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          {title ? <p className="text-xs text-muted-foreground">{t("titleShared", { title })}</p> : null}
        </fieldset>
        <HistoryWarnings warnings={warnings} people={colleagues} kind="share" />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={submit} disabled={saving || checking || selected.size === 0}>
            {saving ? <Spinner /> : <UserPlusIcon />}
            {warnings.length > 0 ? t("addAnyway") : t("addSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One line of a message for the timeline: no Markdown marks nor citation badges. */
function plainPreview(text: string): string {
  return text
    .replace(/\[S\d{1,2}\]/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*-\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
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
