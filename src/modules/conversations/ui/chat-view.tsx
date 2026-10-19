"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowUpIcon,
  BriefcaseIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PencilIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ATTACHMENT_ACCEPT, ATTACHMENT_TYPES, extensionOf, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from "@/modules/documents/file-types";
import { QuotaBanner } from "@/modules/usage/ui/quota-banner";
import type { QuotaState } from "@/modules/usage/quota";
import { CHAT_REQUEST_ERRORS, type ChatRequestError, type ChatStreamEvent } from "../stream-events";
import type { TimelineMessage } from "../types";
import { splitNdjson } from "../ndjson";
import {
  createConversationAction,
  deleteConversationAction,
  removePendingAttachmentAction,
  renameConversationAction,
  setConversationClientAction,
  setConversationModelAction,
} from "../server/actions";
import { titleFromMessage, useChatList } from "./chat-list";
import { AttachmentChip, MessageItem, ModelSwitchDivider } from "./message-item";
import { ModelPicker, type PickerModel } from "./model-picker";

type PendingAttachment = {
  key: string;
  id?: string;
  filename: string;
  kind: "image" | "document";
  truncated?: boolean;
  uploading: boolean;
};

type Props = {
  conversation: { id: string; title: string | null; clientId: string | null; modelChoice: string; messages: TimelineMessage[] } | null;
  models: PickerModel[];
  autoEnabled: boolean;
  defaultChoice: string;
  clients: { id: string; name: string }[];
  initialClientId: string | null;
  quota: QuotaState | null;
  fakeMode: boolean;
};

export function ChatView(props: Props) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const chatList = useChatList();

  const [conversationId, setConversationId] = React.useState(props.conversation?.id ?? null);
  const [title, setTitle] = React.useState(props.conversation?.title ?? null);
  const [clientId, setClientId] = React.useState(props.conversation?.clientId ?? props.initialClientId);
  const [modelChoice, setModelChoice] = React.useState(props.conversation?.modelChoice ?? props.defaultChoice);
  const [messages, setMessages] = React.useState<TimelineMessage[]>(props.conversation?.messages ?? []);
  const [liveId, setLiveId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);
  const [quota, setQuota] = React.useState(props.quota);
  const [requestError, setRequestError] = React.useState<ChatRequestError | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const creating = React.useRef<Promise<string | null> | null>(null);

  const blocked = quota?.state === "blocked";
  const clientName = props.clients.find((c) => c.id === clientId)?.name ?? null;
  const uploading = attachments.some((a) => a.uploading);
  const canSend = !busy && !blocked && !uploading && (input.trim().length > 0 || attachments.some((a) => a.id));

  // Keep the newest message in view while the answer streams, unless the user scrolled up.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  React.useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [input]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  /** Creates the conversation on the first message or attachment. */
  const ensureConversation = React.useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    if (!creating.current) {
      creating.current = (async () => {
        const result = await createConversationAction({ clientId, modelChoice });
        if (!result.ok || !result.data) {
          toast.error(t("createFailed"));
          creating.current = null;
          return null;
        }
        const id = result.data.id;
        setConversationId(id);
        // Same page, new address: no reload, so the answer can stream without interruption.
        window.history.replaceState(null, "", `/chat/${id}`);
        chatList.upsert({ id, title: null, clientId, clientName });
        return id;
      })();
    }
    return creating.current;
  }, [conversationId, clientId, modelChoice, chatList, clientName, t]);

  async function stream(payload: Record<string, unknown>, options: { replaced?: TimelineMessage; onRefused?: () => void } = {}) {
    setBusy(true);
    setRequestError(null);
    stickToBottom.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    let currentLive: string | null = null;
    let restoreReplaced = options.replaced ?? null;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("ndjson")) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        const code = (CHAT_REQUEST_ERRORS as readonly string[]).includes(body.error ?? "") ? (body.error as ChatRequestError) : "server_error";
        setRequestError(code);
        if (code === "quota_exceeded_user" || code === "quota_exceeded_company") {
          setQuota({ state: "blocked", scope: code === "quota_exceeded_user" ? "user" : "company", ratio: 1 });
        }
        options.onRefused?.();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { lines, rest } = splitNdjson(buffer);
        buffer = rest;
        for (const line of lines) {
          const event = JSON.parse(line) as ChatStreamEvent;
          if (event.type === "meta") {
            currentLive = event.assistantMessage.id;
            setLiveId(currentLive);
            setMessages((list) => {
              let next = list.map((m) => (m.id === "pending-user" && event.userMessage ? { ...m, id: event.userMessage.id, seq: event.userMessage.seq } : m));
              if (event.replaces) next = next.filter((m) => m.id !== event.replaces);
              return [
                ...next,
                {
                  id: event.assistantMessage.id,
                  seq: event.assistantMessage.seq,
                  role: "assistant",
                  content: "",
                  status: "streaming",
                  errorCode: null,
                  createdAt: new Date().toISOString(),
                  author: null,
                  model: event.model,
                  routing: event.routing,
                  omittedMessages: event.omittedMessages,
                  attachments: [],
                },
              ];
            });
          } else if (event.type === "delta") {
            const id = currentLive;
            setMessages((list) => list.map((m) => (m.id === id ? { ...m, content: m.content + event.text } : m)));
          } else if (event.type === "done") {
            const id = currentLive;
            restoreReplaced = null;
            setMessages((list) => list.map((m) => (m.id === id ? { ...m, status: "complete" } : m)));
            if (event.quota) setQuota(event.quota);
          } else if (event.type === "error") {
            const id = currentLive;
            const replaced = restoreReplaced?.status === "complete" ? restoreReplaced : null;
            restoreReplaced = null;
            setMessages((list) => {
              const next = list.map((m) => (m.id === id ? { ...m, status: "error" as const, errorCode: event.code } : m));
              if (!replaced) return next;
              // The previous answer was kept by the server: show it again, before the error.
              const index = next.findIndex((m) => m.id === id);
              return [...next.slice(0, index), replaced, ...next.slice(index)];
            });
          }
        }
      }
    } catch {
      if (controller.signal.aborted) {
        const id = currentLive;
        setMessages((list) => list.map((m) => (m.id === id && m.status === "streaming" ? { ...m, status: "stopped" } : m)));
      } else {
        setRequestError("server_error");
      }
    } finally {
      setBusy(false);
      setLiveId(null);
      abortRef.current = null;
      if (conversationId || payload.conversationId) {
        chatList.upsert({ id: String(payload.conversationId), lastMessageAt: new Date().toISOString() });
      }
    }
  }

  async function send() {
    if (!canSend) return;
    const text = input.trim();
    const ready = attachments.filter((a) => a.id);
    const id = await ensureConversation();
    if (!id) return;

    setInput("");
    setAttachments([]);
    setMessages((list) => [
      ...list,
      {
        id: "pending-user",
        seq: Number.MAX_SAFE_INTEGER,
        role: "user",
        content: text,
        status: "complete",
        errorCode: null,
        createdAt: new Date().toISOString(),
        author: null,
        model: null,
        routing: null,
        omittedMessages: 0,
        attachments: ready.map((a) => ({ id: a.id!, filename: a.filename, kind: a.kind, truncated: Boolean(a.truncated) })),
      },
    ]);
    if (!title && text) {
      const derived = titleFromMessage(text);
      setTitle(derived);
      chatList.upsert({ id, title: derived, clientId, clientName });
    }

    await stream(
      { conversationId: id, modelChoice, message: { content: text, attachmentIds: ready.map((a) => a.id) } },
      {
        // Refused before anything was saved: give the user their text and files back.
        onRefused: () => {
          setMessages((list) => list.filter((m) => m.id !== "pending-user"));
          setInput(text);
          setAttachments(ready);
        },
      },
    );
  }

  function regenerate(message: TimelineMessage, choice?: string) {
    if (!conversationId || busy || blocked) return;
    if (choice) setModelChoice(choice);
    void stream({ conversationId, modelChoice: choice ?? modelChoice, regenerate: { messageId: message.id } }, { replaced: message });
  }

  function changeModel(choice: string) {
    setModelChoice(choice);
    if (conversationId) void setConversationModelAction({ conversationId, modelChoice: choice });
  }

  async function changeClient(next: string | null) {
    const previous = clientId;
    setClientId(next);
    if (!conversationId) return;
    const result = await setConversationClientAction({ conversationId, clientId: next });
    if (!result.ok) {
      setClientId(previous);
      toast.error(t("clientLinkFailed"));
      return;
    }
    chatList.upsert({ id: conversationId, clientId: next, clientName: props.clients.find((c) => c.id === next)?.name ?? null });
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
    const list = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > list.length) toast.error(t("attachLimit", { max: MAX_ATTACHMENTS_PER_MESSAGE }));
    const valid = list.filter((f) => {
      const ext = extensionOf(f.name);
      if (!ext) toast.error(t("attachErrors.attachment_type", { name: f.name }));
      else if (f.size > MAX_ATTACHMENT_BYTES) toast.error(t("attachErrors.attachment_too_large", { name: f.name }));
      return ext && f.size <= MAX_ATTACHMENT_BYTES;
    });
    if (valid.length === 0) return;
    const id = await ensureConversation();
    if (!id) return;

    await Promise.all(
      valid.map(async (file) => {
        const key = `${file.name}-${crypto.randomUUID()}`;
        const kind = ATTACHMENT_TYPES[extensionOf(file.name)!].kind;
        setAttachments((current) => [...current, { key, filename: file.name, kind, uploading: true }]);
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`/api/conversations/${id}/attachments`, { method: "POST", body: form }).catch(() => null);
        const body = (await response?.json().catch(() => null)) as
          | { id: string; filename: string; kind: "image" | "document"; truncated: boolean; hasText: boolean; error?: undefined }
          | { error: string }
          | null;
        if (!response?.ok || !body || "error" in body) {
          setAttachments((current) => current.filter((a) => a.key !== key));
          const code = body && "error" in body ? body.error : "upload_failed";
          const known = ["attachment_type", "attachment_too_large", "attachment_unreadable", "upload_failed"].includes(code ?? "") ? code : "upload_failed";
          toast.error(t(`attachErrors.${known as "upload_failed"}`, { name: file.name }));
          return;
        }
        if (!body.hasText) toast.warning(t("noTextFound", { name: file.name }));
        setAttachments((current) => current.map((a) => (a.key === key ? { ...a, id: body.id, truncated: body.truncated, uploading: false } : a)));
      }),
    );
  }

  async function removeAttachment(a: PendingAttachment) {
    setAttachments((current) => current.filter((x) => x.key !== a.key));
    if (a.id) await removePendingAttachmentAction({ attachmentId: a.id });
  }

  const lastAnswerId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const lastIsAnswer = messages.at(-1)?.role === "assistant";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-dvh">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 sm:px-6">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title ?? t("newConversation")}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={cn("max-w-52 gap-1.5 text-muted-foreground", clientName && "text-foreground")}>
              <BriefcaseIcon />
              <span className="truncate">{clientName ?? t("linkClient")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-60 overflow-y-auto">
            <DropdownMenuLabel>{t("clientLabel")}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => changeClient(null)}>{t("noClient")}</DropdownMenuItem>
            {props.clients.length > 0 ? <DropdownMenuSeparator /> : null}
            {props.clients.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => changeClient(c.id)}>
                <span className="truncate">{c.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {conversationId ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("conversationActions")}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <PencilIcon />
                {t("rename")}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                <Trash2Icon />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          {messages.length === 0 ? (
            <EmptyChat onPick={(text) => { setInput(text); textarea.current?.focus(); }} />
          ) : (
            <div className="space-y-8">
              {messages.map((m, index) => {
                const previousAnswer = messages.slice(0, index).reverse().find((x) => x.role === "assistant" && x.model);
                const switched = m.role === "assistant" && m.model && previousAnswer?.model && previousAnswer.model.id !== m.model.id;
                return (
                  <React.Fragment key={m.id}>
                    {switched ? <ModelSwitchDivider provider={m.model!.provider} label={m.model!.label} /> : null}
                    <MessageItem
                      message={m}
                      live={m.id === liveId}
                      isLastAnswer={m.id === lastAnswerId && lastIsAnswer}
                      busy={busy}
                      models={props.models}
                      onRegenerate={(choice) => regenerate(m, choice)}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          <QuotaBanner quota={quota} />
          {requestError && !requestError.startsWith("quota_") ? (
            <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
              {t(`requestErrors.${requestError}`)}
            </p>
          ) : null}
          <div
            className={cn(
              "rounded-2xl border bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15",
              blocked && "opacity-60",
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!blocked) void addFiles(e.dataTransfer.files);
            }}
          >
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {attachments.map((a) => (
                  <AttachmentChip
                    key={a.key}
                    attachment={a}
                    pending={a.uploading}
                    onRemove={a.uploading ? undefined : () => removeAttachment(a)}
                    removeLabel={t("removeAttachment", { name: a.filename })}
                  />
                ))}
              </div>
            ) : null}
            <textarea
              ref={textarea}
              value={input}
              disabled={blocked}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed"
            />
            <div className="flex items-center gap-1 px-2 pb-2">
              <Tooltip content={t("attach")}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("attach")}
                  disabled={blocked || busy || attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                  onClick={() => fileInput.current?.click()}
                >
                  <PaperclipIcon />
                </Button>
              </Tooltip>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <ModelPicker value={modelChoice} onChange={changeModel} models={props.models} autoEnabled={props.autoEnabled} disabled={busy} />
              <div className="flex-1" />
              {busy ? (
                <Button size="icon-sm" variant="secondary" aria-label={t("stop")} onClick={() => abortRef.current?.abort()} className="rounded-full">
                  <SquareIcon className="size-3 fill-current" />
                </Button>
              ) : (
                <Button size="icon-sm" variant="brand" aria-label={t("send")} disabled={!canSend} onClick={() => void send()} className="rounded-full">
                  <ArrowUpIcon />
                </Button>
              )}
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground/80">{props.fakeMode ? t("fakeMode") : t("disclaimer")}</p>
        </div>
      </div>

      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        initial={title ?? ""}
        onSave={async (value) => {
          if (!conversationId) return;
          const result = await renameConversationAction({ conversationId, title: value });
          if (!result.ok) {
            toast.error(t("renameFailed"));
            return;
          }
          setTitle(value);
          chatList.upsert({ id: conversationId, title: value });
          setRenaming(false);
        }}
      />
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
                if (!conversationId) return;
                const result = await deleteConversationAction({ conversationId });
                if (!result.ok) {
                  toast.error(t("deleteFailed"));
                  return;
                }
                chatList.remove(conversationId);
                setDeleting(false);
                toast.success(t("deleted"));
                router.push("/chat");
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

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  const t = useTranslations("chat");
  const suggestions = [t("suggestion1"), t("suggestion2"), t("suggestion3")];
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("emptyTitle")}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
      <div className="mt-8 flex max-w-xl flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-full border bg-card px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: string;
  onSave: (value: string) => Promise<void>;
}) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("rename")}</DialogTitle>
        </DialogHeader>
        {open ? (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const value = String(new FormData(e.currentTarget).get("title") ?? "").trim();
              if (value) await onSave(value);
            }}
          >
            <Input name="title" defaultValue={initial} maxLength={200} autoFocus aria-label={t("rename")} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit">{tCommon("save")}</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
