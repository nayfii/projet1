"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addPersonalNoteAction, deletePersonalNoteAction, updatePersonalNoteAction } from "../server/personal-actions";

/** "What the AI knows about me": the person's own notes, used for them only. */
export function PersonalMemory({ notes }: { notes: { id: string; content: string }[] }) {
  const t = useTranslations("personalMemory");
  const tErrors = useTranslations("errors");
  const [draft, setDraft] = React.useState("");
  const [editing, setEditing] = React.useState<{ id: string; content: string } | null>(null);
  const [busy, startBusy] = React.useTransition();
  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    startBusy(async () => {
      const result = await action();
      if (!result.ok) toast.error(tErrors((result.error ?? "unknown") as "unknown"));
      else done?.();
    });
  const examples = [t("example1"), t("example2"), t("example3")];

  return (
    <section aria-labelledby="personal-memory" className="glass-standard mb-6 rounded-2xl border p-5">
      <h2 id="personal-memory" className="text-[15px] font-semibold tracking-tight">
        {t("title")}
      </h2>
      <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
        <LockIcon className="mt-[3px] size-3.5 shrink-0" />
        {t("description")}
      </p>
      <ul className="mt-5 space-y-1.5">
        {notes.map((n) => (
          <li key={n.id} className="group flex items-center gap-2 rounded-lg border bg-background/40 px-3 py-2 text-sm">
            {editing?.id === n.id ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => updatePersonalNoteAction({ id: n.id, content: editing.content }), () => setEditing(null));
                }}
              >
                <Input value={editing.content} onChange={(e) => setEditing({ id: n.id, content: e.target.value })} maxLength={500} autoFocus aria-label={t("edit")} />
                <Button type="submit" size="icon-sm" aria-label={t("save")} disabled={busy}>
                  <CheckIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("cancel")} onClick={() => setEditing(null)}>
                  <XIcon />
                </Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1">{n.content}</span>
                <Button variant="ghost" size="icon-sm" aria-label={t("edit")} className="opacity-60 group-hover:opacity-100" onClick={() => setEditing(n)}>
                  <PencilIcon />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t("delete")} className="opacity-60 group-hover:opacity-100" disabled={busy} onClick={() => run(() => deletePersonalNoteAction({ id: n.id }))}>
                  <Trash2Icon />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          run(() => addPersonalNoteAction({ content: draft }), () => setDraft(""));
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder={examples[notes.length % examples.length]} aria-label={t("add")} />
        <Button type="submit" disabled={busy || !draft.trim()}>
          <PlusIcon />
          {t("add")}
        </Button>
      </form>
      {notes.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">{t("empty")}</p> : null}
    </section>
  );
}
