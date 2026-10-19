"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { TriangleAlertIcon, WandSparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PickerModel } from "@/modules/conversations/ui/model-picker";
import { toolSchema, type ToolInput, type Visibility } from "../definitions";
import { draftToolAction, saveToolAction } from "../server/actions";
import { ToolEditor } from "./tool-editor";

export type ToolEditorContext = { models: PickerModel[]; autoEnabled: boolean; hasTeam: boolean; canApprove: boolean };

/**
 * "Turn into a tool" (CLAUDE.md §4.6): the AI drafts a reusable tool from the conversation; the person
 * reviews and edits it, then chooses who can use it. Company-wide publication waits for an Admin.
 */
export function TurnIntoToolDialog({
  conversationId,
  open,
  onOpenChange,
  editor,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: ToolEditorContext;
}) {
  const t = useTranslations("tools");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [draft, setDraft] = React.useState<{ tool: ToolInput; aiGenerated: boolean; specific: boolean } | null>(null);
  const [visibility, setVisibility] = React.useState<Visibility>("private");
  const [saving, startSaving] = React.useTransition();

  // A fresh draft each time the dialog opens (the state is reset when it closes).
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void draftToolAction({ conversationId }).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setDraft(result.data);
      else {
        toast.error(tErrors(result.ok ? "unknown" : result.error));
        onOpenChange(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, onOpenChange, tErrors]);
  const close = (next: boolean) => {
    if (!next) {
      setDraft(null);
      setVisibility("private");
    }
    onOpenChange(next);
  };

  const valid = draft ? toolSchema.safeParse(draft.tool).success : false;
  const save = () =>
    startSaving(async () => {
      if (!draft) return;
      const result = await saveToolAction({ id: null, tool: draft.tool, visibility, sourceConversationId: conversationId });
      if (!result.ok || !result.data) {
        toast.error(tErrors(result.ok ? "unknown" : result.error));
        return;
      }
      toast.success(result.data.publication === "pending" ? t("savedPending") : t("saved"));
      close(false);
      router.push(`/library/${result.data.id}`);
    });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WandSparklesIcon className="size-4 text-brand" />
            {t("turnTitle")}
          </DialogTitle>
          <DialogDescription>{t("turnBody")}</DialogDescription>
        </DialogHeader>
        {!draft ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner />
            {t("drafting")}
          </div>
        ) : (
          <>
            {!draft.aiGenerated ? <p className="rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground">{t("draftManual")}</p> : null}
            {draft.specific ? (
              <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px]">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                {t("draftSpecific")}
              </p>
            ) : null}
            <ToolEditor
              value={draft.tool}
              onChange={(tool) => setDraft({ ...draft, tool })}
              visibility={visibility}
              onVisibilityChange={setVisibility}
              {...editor}
            />
          </>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={save} disabled={!draft || !valid || saving}>
            {saving ? <Spinner /> : null}
            {visibility === "company" && !editor.canApprove ? t("saveAndRequest") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
