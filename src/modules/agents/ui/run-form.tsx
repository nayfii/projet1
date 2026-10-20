"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PaperclipIcon, PencilIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from "@/modules/documents/file-types";
import type { Span } from "@/modules/hide/categories";
import { invalidRunFields, toolSchema, type ToolInput, type Visibility } from "../definitions";
import { agentText, type DynamicT } from "../labels";
import { AgentNotice } from "./agent-notice";
import { deleteToolAction, saveToolAction, startRunAction } from "../server/actions";
import type { AgentDetail } from "../server/queries";
import { ToolEditor } from "./tool-editor";
import type { ToolEditorContext } from "./turn-into-tool-dialog";

/** Key under which the first message of a run waits for the conversation screen to send it. */
export const RUN_STORAGE_PREFIX = "tool-run:";

/** What waits for the conversation screen: the filled form and the files already uploaded with it. */
export type PendingRun = {
  message: string;
  attachments: { id: string; filename: string; kind: "image" | "document"; truncated: boolean; text?: string; spans?: Span[] }[];
};

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
  // Files chosen in "files" fields, uploaded with the first message once the run starts.
  const [files, setFiles] = React.useState<Record<string, File[]>>({});
  const [running, startRunning] = React.useTransition();
  const text = agentText(agent, t as unknown as DynamicT);
  const allFiles = Object.values(files).flat();
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
      const id = result.data.conversationId;
      // Files are read on our server like any attachment (and masked by Hide when the message is sent).
      const uploaded: PendingRun["attachments"] = [];
      for (const file of allFiles) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`/api/conversations/${id}/attachments`, { method: "POST", body: form }).catch(() => null);
        const body = (await response?.json().catch(() => null)) as (PendingRun["attachments"][number] & { error?: string }) | null;
        if (!response?.ok || !body || body.error) toast.error(t("fileFailed", { name: file.name }));
        else uploaded.push({ id: body.id, filename: body.filename, kind: body.kind, truncated: body.truncated, text: body.text, spans: body.spans });
      }
      try {
        sessionStorage.setItem(`${RUN_STORAGE_PREFIX}${id}`, JSON.stringify({ message: result.data.message, attachments: uploaded } satisfies PendingRun));
      } catch {
        // Without storage the conversation opens with the form's text ready to send.
      }
      router.push(`/chat/${id}`);
    });

  return (
    <div className="space-y-6">
      {agent.notice ? <AgentNotice notice={agent.notice} /> : null}
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
          const label = f.required ? `${text.field(f)} *` : text.field(f);
          return (
            <Field key={f.key} label={label} htmlFor={id}>
              {f.type === "files" ? (
                <FilesInput
                  id={id}
                  files={files[f.key] ?? []}
                  room={MAX_ATTACHMENTS_PER_MESSAGE - allFiles.length + (files[f.key]?.length ?? 0)}
                  onChange={(next) => {
                    setFiles((all) => ({ ...all, [f.key]: next }));
                    // The form records the file names, so a required field is filled and the AI knows them.
                    set(next.map((file) => file.name).join(", "));
                  }}
                />
              ) : f.type === "textarea" ? (
                <Textarea id={id} rows={5} value={values[f.key] ?? ""} onChange={(e) => set(e.target.value)} />
              ) : f.type === "client" ? (
                <Select value={values[f.key] || NO_CLIENT} onValueChange={(v) => set(v === NO_CLIENT ? "" : v)}>
                  <SelectTrigger id={id} aria-label={text.field(f)}>
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
                  <SelectTrigger id={id} aria-label={text.field(f)}>
                    <SelectValue placeholder={t("choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o} value={o}>
                        {text.option(f, o)}
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

/** A "files" field: the files go with the first message, like attachments in a conversation. */
function FilesInput({ id, files, room, onChange }: { id: string; files: File[]; room: number; onChange: (files: File[]) => void }) {
  const t = useTranslations("tools");
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          const tooBig = chosen.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
          if (tooBig.length) toast.error(t("fileTooBig", { name: tooBig[0].name }));
          const ok = chosen.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
          if (ok.length > room) toast.error(t("tooManyFiles", { max: MAX_ATTACHMENTS_PER_MESSAGE }));
          onChange([...files, ...ok.slice(0, Math.max(room, 0))]);
          e.target.value = "";
        }}
      />
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-[13px]">
              <span className="max-w-52 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={t("removeFile", { name: file.name })}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button type="button" variant="outline" size="sm" disabled={room <= 0} onClick={() => input.current?.click()}>
        <PaperclipIcon />
        {t("addFiles")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("filesHint", { max: MAX_ATTACHMENTS_PER_MESSAGE })}</p>
    </div>
  );
}
