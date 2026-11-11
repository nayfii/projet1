"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Priority } from "../types";
import { CategoryMenu, DateField, PriorityMenu, RecordMenu } from "./primitives";
import { useMilestoneItems } from "./selectors";
import { usePanel, useStudio, useStudioActions } from "./store";

export type CreateKind = "task" | "document" | "milestone";
export type CreateDefaults = { priority?: Priority; milestone_id?: string | null; category_id?: string | null; target_date?: string | null; due_date?: string | null; linkTo?: { kind: "task" | "milestone"; id: string } };

/**
 * Creating anything takes a title and Enter; everything else is optional and can wait (the details
 * open in their panel or editor afterwards).
 */
export function CreateDialog({ kind, defaults, onClose }: { kind: CreateKind; defaults: CreateDefaults; onClose: () => void }) {
  const t = useTranslations("studio.create");
  const tc = useTranslations("studio.common");
  const data = useStudio();
  const actions = useStudioActions();
  const router = useRouter();
  const panel = usePanel();
  const milestones = useMilestoneItems();
  const [title, setTitle] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>(defaults.priority ?? "medium");
  const [date, setDate] = React.useState<string | null>((kind === "milestone" ? defaults.target_date : defaults.due_date) ?? null);
  const [category, setCategory] = React.useState<string | null>(defaults.category_id ?? null);
  const [milestone, setMilestone] = React.useState<string | null>(defaults.milestone_id ?? null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    if (kind === "task") {
      const row = await actions.createTask({ title: name, priority, due_date: date, category_id: category ?? data.milestones.find((m) => m.id === milestone)?.category_id ?? null, milestone_id: milestone });
      setBusy(false);
      if (!row) return;
      onClose();
      toast.success(t("taskCreated"), { action: { label: t("open"), onClick: () => panel.open("task", row.id) } });
    } else if (kind === "milestone") {
      const row = await actions.createMilestone({ title: name, target_date: date, category_id: category });
      setBusy(false);
      if (!row) return;
      onClose();
      toast.success(t("milestoneCreated"), { action: { label: t("open"), onClick: () => panel.open("milestone", row.id) } });
    } else {
      const row = await actions.createDocument({ title: name, category_id: category });
      setBusy(false);
      if (!row) return;
      if (defaults.linkTo) await actions.linkDocument(defaults.linkTo.kind, defaults.linkTo.id, row.id, true);
      onClose();
      router.push(`/studio/knowledge/${row.id}`);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(`${kind}.title`)}</DialogTitle>
            <DialogDescription>{t(`${kind}.description`)}</DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={kind === "task" ? 300 : 200}
            placeholder={t(`${kind}.placeholder`)}
            aria-label={t(`${kind}.name`)}
            className="w-full border-0 bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground/60"
          />
          <div className="-mx-2 flex flex-wrap items-center gap-1 border-t pt-3">
            {kind === "task" ? <PriorityMenu value={priority} onChange={setPriority} /> : null}
            {kind !== "document" ? <DateField value={date} onChange={setDate} label={kind === "task" ? t("due") : t("target")} placeholder={kind === "task" ? t("due") : t("target")} /> : null}
            {kind === "task" ? <RecordMenu value={milestone} items={milestones} onChange={setMilestone} noneLabel={t("noMilestone")} ariaLabel={t("milestoneLabel")} /> : null}
            <CategoryMenu value={category} categories={data.categories} onChange={setCategory} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              {t(`${kind}.submit`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
