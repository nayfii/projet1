"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { renameConversationAction } from "../server/actions";

/**
 * The conversation's title in the chat header. A double-click turns it into a field with the title
 * selected: Entrée or a click elsewhere saves, Échap cancels. The sidebar shows the new title at once;
 * if saving fails, the previous title comes back with a message.
 */
export function EditableTitle({
  conversationId,
  title,
  placeholder,
  canEdit,
  onRenamed,
}: {
  conversationId: string | null;
  title: string | null;
  placeholder: string;
  canEdit: boolean;
  onRenamed: (title: string | null) => void;
}) {
  const t = useTranslations("chat");
  const tErrors = useTranslations("errors");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const editable = canEdit && conversationId !== null;

  React.useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const start = () => {
    if (!editable || saving) return;
    setDraft(title ?? "");
    setEditing(true);
  };

  const save = async () => {
    if (!editing) return;
    setEditing(false);
    const next = draft.trim();
    if (!next || next === title || !conversationId) return;
    const previous = title;
    onRenamed(next);
    setSaving(true);
    const result = await renameConversationAction({ conversationId, title: next });
    setSaving(false);
    if (!result.ok) {
      onRenamed(previous);
      toast.error(tErrors(result.error));
    }
  };

  if (editing) {
    return (
      <input
        ref={input}
        value={draft}
        maxLength={200}
        aria-label={t("renameTitle")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className="h-8 min-w-0 flex-1 rounded-md border bg-background/60 px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    );
  }

  return (
    <h1
      className={cn("flex min-w-0 flex-1 items-center gap-2 text-sm font-medium", editable && "cursor-text")}
      title={editable ? t("renameHint") : undefined}
      onDoubleClick={start}
    >
      <span className="truncate">{title ?? placeholder}</span>
      {saving ? <Spinner className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      {editable ? (
        // Keyboard and screen readers: the same edit without a double-click.
        <button type="button" onClick={start} className="sr-only focus:not-sr-only focus:rounded focus:px-1 focus:text-xs focus:text-muted-foreground">
          {t("renameTitle")}
        </button>
      ) : null}
    </h1>
  );
}
