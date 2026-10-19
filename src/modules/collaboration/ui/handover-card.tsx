"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDownIcon, FileStackIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { Markdown } from "@/modules/conversations/ui/markdown";
import { HANDOVER_SECTIONS, type HandoverSections } from "../handover-sections";
import { updateHandoverAction } from "../server/actions";
import type { Handover } from "../server/queries";

/** Smart Handover: the file the recipient of a transfer finds at the top. Only they see and edit it. */
export function HandoverCard({ handover, className }: { handover: Handover; className?: string }) {
  const t = useTranslations("collaboration");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [open, setOpen] = React.useState(true);
  const [editing, setEditing] = React.useState(false);
  const [sections, setSections] = React.useState<HandoverSections>(handover.sections);
  const [draft, setDraft] = React.useState<HandoverSections>(handover.sections);
  const [editedAt, setEditedAt] = React.useState(handover.editedAt);
  const [saving, startSaving] = React.useTransition();
  const empty = HANDOVER_SECTIONS.every((k) => !sections[k]);

  const save = () =>
    startSaving(async () => {
      const result = await updateHandoverAction({ handoverId: handover.id, sections: draft });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setSections(draft);
      setEditedAt(new Date().toISOString());
      setEditing(false);
      toast.success(t("handoverSaved"));
    });

  return (
    <section aria-label={t("handoverTitle")} className={cn("rounded-xl border bg-card shadow-xs", className)}>
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <FileStackIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{t("handoverTitle")}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {handover.fromName ? t("handoverFrom", { name: handover.fromName }) : t("handoverFromUnknown")}
            {" · "}
            {editedAt
              ? t("handoverEdited", { date: format.dateTime(new Date(editedAt), { dateStyle: "medium" }) })
              : format.dateTime(new Date(handover.createdAt), { dateStyle: "medium" })}
          </p>
        </div>
        {open && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => {
              setDraft(sections);
              setEditing(true);
            }}
          >
            <PencilIcon />
            <span className="hidden sm:inline">{t("edit")}</span>
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label={open ? t("hide") : t("show")} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </header>

      {open ? (
        <div className="space-y-4 border-t px-4 py-4">
          <p className="text-xs text-muted-foreground">{handover.aiGenerated ? t("handoverAi") : t("handoverManual")}</p>
          {editing ? (
            <>
              {HANDOVER_SECTIONS.map((key) => (
                <label key={key} className="block space-y-1.5">
                  <span className="text-[13px] font-medium">{t(`sections.${key}`)}</span>
                  <Textarea
                    value={draft[key]}
                    maxLength={8000}
                    rows={key === "summary" ? 4 : 3}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  />
                </label>
              ))}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {tCommon("cancel")}
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Spinner /> : null}
                  {tCommon("save")}
                </Button>
              </div>
            </>
          ) : empty ? (
            <p className="text-[13px] text-muted-foreground">{t("handoverEmpty")}</p>
          ) : (
            HANDOVER_SECTIONS.filter((key) => sections[key]).map((key) => (
              <div key={key} className="space-y-1">
                <h3 className="text-[13px] font-medium text-muted-foreground">{t(`sections.${key}`)}</h3>
                <Markdown className="text-sm">{sections[key]}</Markdown>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
