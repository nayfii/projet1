"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FlaskConicalIcon, LightbulbIcon, ListTodoIcon, StickyNoteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd, RecordMenu, Segmented } from "./primitives";
import { useIndex } from "./selectors";
import { usePanel, useScaleActions } from "./store";

export type CaptureKind = "task" | "idea" | "test" | "note";
export type CaptureDefaults = { kind?: CaptureKind; projectId?: string | null; milestoneId?: string | null; weekStart?: string | null; dueDate?: string | null; status?: string; productKind?: string };

/**
 * Quick capture: a title is enough. A task or an idea lands in "To sort" unless a project or a week is
 * given; it can be organised later.
 */
export function CaptureDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: CaptureDefaults }) {
  const t = useTranslations("scale.capture");
  const tc = useTranslations("scale.common");
  const actions = useScaleActions();
  const index = useIndex();
  const panel = usePanel();
  const router = useRouter();
  const [kind, setKind] = React.useState<CaptureKind>(defaults.kind ?? "task");
  const [title, setTitle] = React.useState("");
  const [projectId, setProjectId] = React.useState<string | null>(defaults.projectId ?? null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- the dialog starts from the defaults it was opened with */
    setKind(defaults.kind ?? "task");
    setProjectId(defaults.projectId ?? null);
    setError(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, defaults]);

  async function submit(again: boolean) {
    const text = title.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(false);
    let openTarget: (() => void) | null = null;
    if (kind === "task" || kind === "idea") {
      const row = await actions.create("task", {
        title: text,
        kind: kind === "idea" ? "idea" : (defaults.productKind ?? "task"),
        status: defaults.status ?? (projectId || defaults.weekStart || defaults.dueDate ? "todo" : "triage"),
        ...(projectId ? { project_id: projectId } : {}),
        ...(defaults.milestoneId ? { milestone_id: defaults.milestoneId } : {}),
        ...(defaults.weekStart ? { week_start: defaults.weekStart } : {}),
        ...(defaults.dueDate ? { due_date: defaults.dueDate } : {}),
      });
      if (row) openTarget = () => panel.open("task", row.id);
      else setError(true);
    } else if (kind === "test") {
      const row = await actions.create("test", { title: text, ...(projectId ? { project_id: projectId } : {}) });
      if (row) openTarget = () => router.push(`/scale/tests/${row.id}`);
      else setError(true);
    } else {
      const row = await actions.create("document", { title: text, template_key: "blank", ...(projectId ? { project_id: projectId } : {}) });
      if (row) openTarget = () => router.push(`/scale/strategy/${row.id}`);
      else setError(true);
    }
    setBusy(false);
    if (!openTarget) return;
    setTitle("");
    toast.success(t(`added.${kind}`), { action: { label: tc("open"), onClick: openTarget } });
    if (!again) onOpenChange(false);
  }

  const kinds: { value: CaptureKind; label: string; icon: React.ReactNode }[] = [
    { value: "task", label: t("kinds.task"), icon: <ListTodoIcon /> },
    { value: "idea", label: t("kinds.idea"), icon: <LightbulbIcon /> },
    { value: "test", label: t("kinds.test"), icon: <FlaskConicalIcon /> },
    { value: "note", label: t("kinds.note"), icon: <StickyNoteIcon /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-lg gap-5">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Segmented value={kind} options={kinds} onChange={setKind} label={t("kindLabel")} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
          className="space-y-4"
        >
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={kind === "task" || kind === "idea" ? 300 : 200}
            placeholder={t(`placeholders.${kind}`)}
            aria-label={t("titleLabel")}
            aria-invalid={error || undefined}
            className="h-11 text-[15px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit(true);
              }
            }}
          />
          {error ? <p className="text-[13px] text-destructive">{t("failed")}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <RecordMenu
              value={projectId}
              onChange={setProjectId}
              items={index.projects.map((p) => ({ id: p.id, label: p.title }))}
              noneLabel={t("noProject")}
              ariaLabel={t("projectLabel")}
              className="-ml-2"
            />
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                <Kbd>{"⌘"}</Kbd>
                <Kbd>{"↵"}</Kbd> {t("addAnother")}
              </span>
              <Button type="submit" size="sm" disabled={!title.trim() || busy}>
                {t("add")}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
