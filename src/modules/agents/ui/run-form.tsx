"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { invalidRunFields, toolSchema, type ToolInput, type Visibility } from "../definitions";
import { deleteToolAction, saveToolAction, startRunAction } from "../server/actions";
import type { AgentDetail } from "../server/queries";
import { ToolEditor } from "./tool-editor";
import type { ToolEditorContext } from "./turn-into-tool-dialog";

/** Key under which the first message of a run waits for the conversation screen to send it. */
export const RUN_STORAGE_PREFIX = "tool-run:";

const NO_CLIENT = "__none";

/** A tool or agent runs as a simple form; it then continues as a normal conversation. */
export function RunForm({
  agent,
  clients,
  editor,
  canDelete,
}: {
  agent: AgentDetail;
  clients: { id: string; name: string }[];
  editor: ToolEditorContext;
  canDelete: boolean;
}) {
  const t = useTranslations("tools");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [running, startRunning] = React.useTransition();
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const missing = invalidRunFields(agent.inputFields, values);

  const run = () =>
    startRunning(async () => {
      const result = await startRunAction({ agentId: agent.id, values });
      if (!result.ok || !result.data) {
        toast.error(tErrors(result.ok ? "unknown" : result.error));
        return;
      }
      try {
        sessionStorage.setItem(`${RUN_STORAGE_PREFIX}${result.data.conversationId}`, result.data.message);
      } catch {
        // Without storage the conversation opens with the form's text ready to send.
      }
      router.push(`/chat/${result.data.conversationId}`);
    });

  return (
    <div className="space-y-6">
      {!agent.usable ? <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px]">{t("notUsable")}</p> : null}
      <form
        className="space-y-4 rounded-xl border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (missing.length === 0) run();
        }}
      >
        {agent.inputFields.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("noFields")}</p> : null}
        {agent.inputFields.map((f) => {
          const id = `run-${f.key}`;
          const set = (value: string) => setValues((v) => ({ ...v, [f.key]: value }));
          const label = f.required ? `${f.label} *` : f.label;
          return (
            <Field key={f.key} label={label} htmlFor={id}>
              {f.type === "textarea" ? (
                <Textarea id={id} rows={5} value={values[f.key] ?? ""} onChange={(e) => set(e.target.value)} />
              ) : f.type === "client" ? (
                <Select value={values[f.key] || NO_CLIENT} onValueChange={(v) => set(v === NO_CLIENT ? "" : v)}>
                  <SelectTrigger id={id} aria-label={f.label}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CLIENT}>{t("noClient")}</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "select" ? (
                <Select value={values[f.key] ?? ""} onValueChange={set}>
                  <SelectTrigger id={id} aria-label={f.label}>
                    <SelectValue placeholder={t("choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input id={id} value={values[f.key] ?? ""} onChange={(e) => set(e.target.value)} />
              )}
            </Field>
          );
        })}
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground">{t("runHint")}</p>
          <Button type="submit" variant="brand" disabled={!agent.usable || missing.length > 0 || running}>
            {running ? <Spinner /> : <PlayIcon />}
            {t("run")}
          </Button>
        </div>
      </form>

      <details className="rounded-xl border px-4 py-3 text-sm">
        <summary className="cursor-pointer text-[13px] font-medium">{t("showInstructions")}</summary>
        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">{agent.instructions}</p>
      </details>

      {agent.mine || canDelete ? (
        <div className="flex flex-wrap gap-2">
          {agent.mine && !agent.builtin ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon />
              {t("edit")}
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(true)}>
              <Trash2Icon />
              {t("delete")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {editing ? <EditDialog agent={agent} editor={editor} onClose={() => setEditing(false)} /> : null}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const result = await deleteToolAction({ id: agent.id });
                if (!result.ok) {
                  toast.error(tErrors(result.error));
                  return;
                }
                toast.success(t("deleted"));
                router.push("/library");
              }}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditDialog({ agent, editor, onClose }: { agent: AgentDetail; editor: ToolEditorContext; onClose: () => void }) {
  const t = useTranslations("tools");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [tool, setTool] = React.useState<ToolInput>({
    name: agent.name,
    description: agent.description,
    department: agent.department,
    instructions: agent.instructions,
    input_fields: agent.inputFields,
    allowed_models: agent.allowedModels,
    default_model: agent.defaultModel,
    tools: agent.tools,
    memory_scope: agent.memoryScope,
    output_format: agent.outputFormat,
  });
  const [visibility, setVisibility] = React.useState<Visibility>(agent.visibility);
  const [saving, startSaving] = React.useTransition();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
          <DialogDescription>{agent.visibility === "company" && agent.publication === "approved" ? t("editApprovedHint") : t("editHint")}</DialogDescription>
        </DialogHeader>
        <ToolEditor value={tool} onChange={setTool} visibility={visibility} onVisibilityChange={setVisibility} {...editor} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={!toolSchema.safeParse(tool).success || saving}
            onClick={() =>
              startSaving(async () => {
                const result = await saveToolAction({ id: agent.id, tool, visibility, sourceConversationId: null });
                if (!result.ok || !result.data) {
                  toast.error(tErrors(result.ok ? "unknown" : result.error));
                  return;
                }
                toast.success(result.data.publication === "pending" ? t("savedPending") : t("saved"));
                onClose();
                router.refresh();
              })
            }
          >
            {saving ? <Spinner /> : null}
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
