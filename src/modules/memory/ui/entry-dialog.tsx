"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Spinner } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createEntryAction, updateEntryAction } from "../server/actions";

export type MemoryTarget = { spaceId: string; label: string };

/**
 * Create or edit a memory entry. Used on memory pages and from a chat message ("Save to memory"),
 * where the person chooses which memory to save into and can rewrite the text first.
 */
export function EntryDialog({
  open,
  onOpenChange,
  targets,
  initial,
  entryId,
  source,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: MemoryTarget[];
  initial?: { title: string; content: string; spaceId?: string };
  entryId?: string;
  source?: { conversationId: string; messageId: string };
  onSaved?: () => void;
}) {
  const t = useTranslations("memory");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [saving, startSaving] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{entryId ? t("editEntry") : source ? t("saveToMemory") : t("newEntry")}</DialogTitle>
          {!entryId ? <DialogDescription>{source ? t("saveToMemoryHint") : t("newEntryHint")}</DialogDescription> : null}
        </DialogHeader>
        {open ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const title = String(form.get("title") ?? "").trim();
              const content = String(form.get("content") ?? "").trim();
              const spaceId = String(form.get("spaceId") ?? initial?.spaceId ?? targets[0]?.spaceId ?? "");
              if (!title || !content) return;
              startSaving(async () => {
                const result = entryId
                  ? await updateEntryAction({ entryId, title, content })
                  : await createEntryAction({ spaceId, title, content, source });
                if (!result.ok) {
                  toast.error(tErrors(result.error));
                  return;
                }
                const indexed = !("data" in result) || !result.data || (result.data as { indexed?: boolean }).indexed !== false;
                toast.success(entryId ? t("entryUpdated") : t("entrySaved"));
                if (!indexed) toast.warning(t("notIndexed"));
                onOpenChange(false);
                onSaved?.();
              });
            }}
          >
            {!entryId && targets.length > 1 ? (
              <Field label={t("whichMemory")} htmlFor="entry-space">
                <Select name="spaceId" defaultValue={initial?.spaceId ?? targets[0].spaceId}>
                  <SelectTrigger id="entry-space">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((target) => (
                      <SelectItem key={target.spaceId} value={target.spaceId}>
                        {target.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field label={t("entryTitle")} htmlFor="entry-title">
              <Input id="entry-title" name="title" required maxLength={200} defaultValue={initial?.title ?? ""} autoFocus />
            </Field>
            <Field label={t("entryContent")} htmlFor="entry-content" hint={t("entryContentHint")}>
              <Textarea id="entry-content" name="content" required maxLength={20000} rows={8} defaultValue={initial?.content ?? ""} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={saving || (!entryId && targets.length === 0)}>
                {saving ? <Spinner /> : null}
                {tCommon("save")}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
