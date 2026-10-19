"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRightLeftIcon,
  ArrowUpIcon,
  AtSignIcon,
  BriefcaseIcon,
  LightbulbIcon,
  LogOutIcon,
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
import { ConversationSuggestions } from "@/modules/memory/ui/conversation-suggestions";
import { AutoSwitch, FilePreview, HideBar, HideOverlay, useHideComposer, type HidePayload } from "@/modules/hide/ui/hide-composer";
import type { HideMode, HideSettings, Span } from "@/modules/hide/categories";
import { MODEL_CHOICE_AUTO, modelDisplay } from "@/modules/providers/catalog";
import { PROVIDER_IDS } from "@/modules/providers/types";
import { leaveConversationAction, loadParticipantsAction, loadTimelineMessagesAction } from "@/modules/collaboration/server/actions";
import type { Colleague, Handover, Participant } from "@/modules/collaboration/server/queries";
import { AddPeopleDialog, ParticipantsBar, TypingLine } from "@/modules/collaboration/ui/people";
import { TransferDialog } from "@/modules/collaboration/ui/transfer-dialog";
import { HandoverCard } from "@/modules/collaboration/ui/handover-card";
import { filterMentions, MentionMenu, mentionAt, PROVIDER_TOKENS, type MentionOption } from "@/modules/collaboration/ui/mention-menu";
import { useConversationRealtime } from "@/modules/collaboration/ui/use-conversation-realtime";
import { ConfrontDialog } from "@/modules/confronter/ui/confront-dialog";
import type { ConfrontEstimate } from "@/modules/confronter/server/actions";
import type { Confrontation, ConfrontationProgress } from "@/modules/confronter/types";

type PendingAttachment = {
  key: string;
  id?: string;
  filename: string;
  kind: "image" | "document";
  truncated?: boolean;
  uploading: boolean;
  /** Hide: the file's text and what looks sensitive in it (from the server), for the preview. */
  text?: string;
  spans?: Span[];
};

type Props = {
  conversation: {
    id: string;
    title: string | null;
    clientId: string | null;
    modelChoice: string;
    messages: TimelineMessage[];
    lastHideModes?: HideMode[];
  } | null;
  models: PickerModel[];
  autoEnabled: boolean;
  defaultChoice: string;
  clients: { id: string; name: string }[];
  initialClientId: string | null;
  quota: QuotaState | null;
  fakeMode: boolean;
  memoryTargets: { spaceId: string; clientId: string | null; label: string }[];
  hide: HideSettings;
  /** The viewer. */
  me: { id: string; name: string | null };
  /** Collaboration: who takes part, colleagues who could join or receive a transfer, and the handover file the viewer received. */
  participants: Participant[];
  colleagues: Colleague[];
  handover: Handover | null;
};

// Shared by the input and the Manual-mode overlay drawn under it: they must wrap text identically.
const TEXTAREA_LAYOUT = "px-4 pt-3.5 pb-2 text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word]";

export function ChatView(props: Props) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const tHide = useTranslations("hide");
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
  const [suggesting, setSuggesting] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // Collaboration (CLAUDE.md §4.4): participants, real time, mentions, transfer.
  const tCollab = useTranslations("collaboration");
  const tErrors = useTranslations("errors");
  const [participants, setParticipants] = React.useState(props.participants);
  // "Ajouter" dialog, open with these colleagues preselected (Who Can Help's "Inviter").
  const [adding, setAdding] = React.useState<string[] | null>(null);
  const [transferring, setTransferring] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const [caret, setCaret] = React.useState(0);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [mentionDismissed, setMentionDismissed] = React.useState<number | null>(null);
  const group = participants.length > 1;
  // A new conversation is the viewer's own; otherwise the participant marked owner.
  const isOwner = participants.length === 0 || participants.some((p) => p.userId === props.me.id && p.role === "owner");
  const participantIds = new Set(participants.map((p) => p.userId));
  // The answer this browser is streaming: real-time reloads leave it alone.
  const liveRef = React.useRef<string | null>(null);
  // Confronter: the question being confirmed, and live progress of running confrontations.
  const [confrontTarget, setConfrontTarget] = React.useState<{ conversationId: string; messageId: string; excerpt: string } | null>(null);
  const [confrontProgress, setConfrontProgress] = React.useState<Record<string, ConfrontationProgress>>({});

  const abortRef = React.useRef<AbortController | null>(null);
  // Stop clicked before the server said which answer it is writing: stop it as soon as it does.
  const stopPending = React.useRef(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // A conversation received with a handover file opens at the top, on the file.
  const stickToBottom = React.useRef(!props.handover);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const creating = React.useRef<Promise<string | null> | null>(null);
  const [inputScroll, setInputScroll] = React.useState(0);
  // Hide: modes of the last message sent in this conversation, else the company's defaults.
  const [previewKey, setPreviewKey] = React.useState<string | null>(null);
  // A click on "Envoyer" while Hide checks the text (a fraction of a second) is ignored.
  const checking = React.useRef(false);
  const hide = useHideComposer({
    text: input,
    files: attachments.filter((a) => a.id && a.kind === "document" && a.text).map((a) => ({ key: a.key, filename: a.filename, text: a.text!, spans: a.spans ?? [] })),
    initialAuto: (props.conversation?.lastHideModes?.length ? props.conversation.lastHideModes : props.hide.defaultModes).includes("automatic"),
    autoCategories: props.hide.autoCategories,
  });

  const blocked = quota?.state === "blocked";
  // In a group, people can still talk to each other without credits; only "@IA" is refused.
  const inputBlocked = blocked && !group;
  const clientName = props.clients.find((c) => c.id === clientId)?.name ?? null;
  const uploading = attachments.some((a) => a.uploading);
  // An answer started before this page was opened is still being written: wait for it. In a group,
  // real time shows it when it is done and people keep talking meanwhile.
  const pendingElsewhere = !group && (props.conversation?.messages.some((m) => m.status === "streaming") ?? false);
  const canSend = !busy && !pendingElsewhere && !inputBlocked && !uploading && (input.trim().length > 0 || attachments.some((a) => a.id));

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

  // Leaving the page does not stop an answer: it keeps being written and saved on the server
  // (only the Stop button or closing the tab stops it). Track whether this view is still shown.
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The address of a new conversation is changed in place (see ensureConversation), so the browser's
  // Back button can come back here with the empty "new conversation" screen under /chat/<id>.
  // Load the real conversation in that case.
  React.useEffect(() => {
    if (props.conversation === null && /^\/chat\/[0-9a-f-]{36}$/i.test(window.location.pathname)) router.replace(window.location.pathname);
  }, [props.conversation, router]);

  // Refresh until the answer started elsewhere is done (the page then reloads its messages).
  React.useEffect(() => {
    if (!pendingElsewhere) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [pendingElsewhere, router]);

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
        if (mounted.current) window.history.replaceState(null, "", `/chat/${id}`);
        chatList.upsert({ id, title: null, clientId, clientName });
        return id;
      })();
    }
    return creating.current;
  }, [conversationId, clientId, modelChoice, chatList, clientName, t]);

  const refreshParticipants = React.useCallback(async () => {
    if (!conversationId) return;
    const next = await loadParticipantsAction({ conversationId });
    // Nobody visible: the viewer no longer has access (transferred or removed from another window).
    if (next.length === 0) {
      router.push("/chat");
      return;
    }
    setParticipants(next);
  }, [conversationId, router]);

  // Real time: colleagues' messages and the answers they ask for, as this person may see them.
  const incoming = React.useRef(new Set<string>());
  const flushing = React.useRef(false);
  const { online, typing, notifyTyping, stopTyping } = useConversationRealtime({
    conversationId,
    meId: props.me.id,
    onMessage: (id) => {
      // Alone in the conversation, this browser already shows everything.
      if (!group || !conversationId) return;
      incoming.current.add(id);
      if (flushing.current) return;
      flushing.current = true;
      const target = conversationId;
      setTimeout(async () => {
        while (incoming.current.size > 0) {
          const ids = [...incoming.current].slice(0, 50);
          ids.forEach((x) => incoming.current.delete(x));
          const fresh = await loadTimelineMessagesAction({ conversationId: target, ids });
          if (mounted.current) setMessages((list) => mergeMessages(list, ids, fresh, liveRef.current, props.me.id));
        }
        flushing.current = false;
      }, 250);
    },
    onParticipants: () => void refreshParticipants(),
  });
  const typingNames = [...typing].map((id) => participants.find((p) => p.userId === id)?.name).filter((n): n is string => Boolean(n));

  async function openAdd(preselected: string[]) {
    const id = await ensureConversation();
    if (id) setAdding(preselected);
  }

  // Mentions: "@IA" (the selected model or Auto), "@Claude", "@ChatGPT", "@Gemini" for allowed providers.
  const mentionOptions = React.useMemo(() => {
    const selected = props.models.find((m) => m.id === modelChoice);
    const options: MentionOption[] = [
      {
        token: tCollab("aiToken"),
        aliases: ["ai", "ia"],
        provider: null,
        hint: modelChoice === MODEL_CHOICE_AUTO ? tCollab("mentionAuto") : selected ? modelDisplay(selected.provider, selected.label).brand : tCollab("mentionSelected"),
      },
    ];
    for (const provider of PROVIDER_IDS) {
      const usable = props.models.filter((m) => m.provider === provider && m.available);
      const model = usable.find((m) => m.tier === "balanced") ?? usable[0];
      if (model) options.push({ ...PROVIDER_TOKENS[provider], provider, hint: modelDisplay(provider, model.label).name });
    }
    return options;
  }, [props.models, modelChoice, tCollab]);
  const mention = group ? mentionAt(input, caret) : null;
  const mentionMatches =
    mention && mention.start !== mentionDismissed && !mentionOptions.some((o) => [o.token, ...o.aliases].some((n) => n.toLowerCase() === mention.query.toLowerCase()))
      ? filterMentions(mentionOptions, mention.query)
      : [];
  const activeMention = Math.min(mentionIndex, Math.max(mentionMatches.length - 1, 0));

  function insertAtCaret(start: number, end: number, text: string) {
    const el = textarea.current;
    const position = start + text.length;
    setInput(input.slice(0, start) + text + input.slice(end));
    setCaret(position);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(position, position);
    });
  }

  function pickMention(option: MentionOption) {
    if (mention) insertAtCaret(mention.start, mention.start + 1 + mention.query.length, `@${option.token} `);
  }

  /** The "@" button: starts a mention where the caret is. */
  function startMention() {
    const at = textarea.current?.selectionStart ?? input.length;
    setMentionDismissed(null);
    insertAtCaret(at, at, at > 0 && !/\s/.test(input[at - 1]) ? " @" : "@");
  }

  async function stream(payload: Record<string, unknown>, options: { replaced?: TimelineMessage; onRefused?: () => void; confrontation?: Confrontation } = {}) {
    setBusy(true);
    setRequestError(null);
    stickToBottom.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    stopPending.current = false;
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
          if (event.type === "confront") {
            const id = currentLive;
            if (!id) continue;
            setConfrontProgress((all) => {
              const list = (all[id] ?? []).filter((p) => !(p.stage === event.stage && p.modelId === event.modelId));
              return { ...all, [id]: [...list, { stage: event.stage, modelId: event.modelId, status: event.status }] };
            });
          } else if (event.type === "confrontation") {
            const id = currentLive;
            setMessages((list) => list.map((m) => (m.id === id ? { ...m, confrontation: event.confrontation } : m)));
          } else if (event.type === "posted") {
            // Group conversation without a mention: posted for the others, no answer.
            setMessages((list) => confirmPending(list, event.userMessage));
          } else if (event.type === "meta") {
            currentLive = event.assistantMessage.id;
            liveRef.current = currentLive;
            setLiveId(currentLive);
            if (stopPending.current) {
              requestStop(currentLive);
              controller.abort();
            }
            setMessages((list) => {
              // Real time may have brought these messages already: the stream's version wins.
              let next = list.filter((m) => m.id !== event.assistantMessage.id);
              if (event.userMessage) next = confirmPending(next, event.userMessage);
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
                  sources: [],
                  maskedContent: null,
                  hideCounts: null,
                  hideSpans: [],
                  contextLimited: event.contextLimited,
                  suggestedColleagues: [],
                  confrontation: options.confrontation ?? null,
                },
              ];
            });
          } else if (event.type === "delta") {
            const id = currentLive;
            setMessages((list) => list.map((m) => (m.id === id ? { ...m, content: m.content + event.text } : m)));
          } else if (event.type === "done") {
            const id = currentLive;
            restoreReplaced = null;
            setMessages((list) =>
              list.map((m) =>
                m.id === id
                  ? { ...m, status: "complete", sources: event.sources ?? [], maskedContent: event.masked ?? null, suggestedColleagues: event.suggestedColleagues ?? [] }
                  : m,
              ),
            );
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
      liveRef.current = null;
      setLiveId(null);
      abortRef.current = null;
      if (conversationId || payload.conversationId) {
        chatList.upsert({ id: String(payload.conversationId), lastMessageAt: new Date().toISOString() });
      }
    }
  }

  /** `hidePayload`: given once the person answered the confirmation ("Protéger et envoyer" / "Envoyer tel quel"). */
  async function send(hidePayload?: HidePayload) {
    if (!canSend) return;
    // Without "Masquage auto", items still in red are confirmed before anything is sent.
    if (!hidePayload) {
      if (checking.current) return;
      checking.current = true;
      const ask = await hide.needsConfirmation().finally(() => (checking.current = false));
      if (ask) {
        hide.setConfirming(true);
        return;
      }
    }
    hide.setConfirming(false);
    const hideChoices = hidePayload ?? hide.payload();
    const text = input.trim();
    const ready = attachments.filter((a) => a.id);
    const id = await ensureConversation();
    if (!id) return;

    setInput("");
    setAttachments([]);
    stopTyping();
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
        author: { id: props.me.id, name: props.me.name },
        model: null,
        routing: null,
        omittedMessages: 0,
        attachments: ready.map((a) => ({ id: a.id!, filename: a.filename, kind: a.kind, truncated: Boolean(a.truncated) })),
        sources: [],
        maskedContent: null,
        hideCounts: null,
        hideSpans: [],
        contextLimited: false,
        suggestedColleagues: [],
        confrontation: null,
      },
    ]);
    if (!title && text) {
      const derived = titleFromMessage(text);
      setTitle(derived);
      chatList.upsert({ id, title: derived, clientId, clientName });
    }

    await stream(
      { conversationId: id, modelChoice, message: { content: text, attachmentIds: ready.map((a) => a.id) }, hide: hideChoices },
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

  /** Stop button: the server stops writing (and saves what was written), then the local stream closes. */
  function stopAnswer() {
    if (!liveId) {
      // The answer has not started yet (memory search, model choice): the server is told as soon as it starts.
      stopPending.current = true;
      return;
    }
    requestStop(liveId);
    abortRef.current?.abort();
  }

  function requestStop(messageId: string) {
    void fetch("/api/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
  }

  function regenerate(message: TimelineMessage, choice?: string) {
    if (!conversationId || busy || blocked) return;
    if (choice) setModelChoice(choice);
    void stream({ conversationId, modelChoice: choice ?? modelChoice, regenerate: { messageId: message.id } }, { replaced: message });
  }

  /** Confronter, once confirmed: the models answer, critique each other, then the synthesis. */
  function confront(estimate: Extract<ConfrontEstimate, { ok: true }>) {
    const target = confrontTarget;
    setConfrontTarget(null);
    if (!conversationId || !target || busy) return;
    void stream(
      { conversationId, confront: { messageId: target.messageId } },
      {
        confrontation: {
          questionId: target.messageId,
          questionExcerpt: target.excerpt,
          models: estimate.models,
          judge: estimate.judge,
          answers: [],
          critiques: [],
          synthesis: null,
          credits: 0,
        },
      },
    );
  }

  /** The question a "Confronter" button refers to: the message itself, or the question an answer replies to. */
  function confrontHandler(index: number): (() => void) | undefined {
    const m = messages[index];
    const question = m.role === "user" ? m : messages.slice(0, index).reverse().find((x) => x.role === "user");
    if (!conversationId || !question || question.id === "pending-user" || !question.content.trim() || busy || pendingElsewhere) return undefined;
    return () => setConfrontTarget({ conversationId, messageId: question.id, excerpt: question.content.slice(0, 200) });
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
      toast.error(result.error === "no_client_access" ? tErrors("no_client_access") : t("clientLinkFailed"));
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
          | { id: string; filename: string; kind: "image" | "document"; truncated: boolean; hasText: boolean; text?: string; spans?: Span[]; error?: undefined }
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
        setAttachments((current) =>
          current.map((a) => (a.key === key ? { ...a, id: body.id, truncated: body.truncated, uploading: false, text: body.text, spans: body.spans } : a)),
        );
      }),
    );
  }

  async function removeAttachment(a: PendingAttachment) {
    setAttachments((current) => current.filter((x) => x.key !== a.key));
    if (a.id) await removePendingAttachmentAction({ attachmentId: a.id });
  }

  const memoryTargets = [...props.memoryTargets].sort((a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId));
  const lastAnswerId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const lastIsAnswer = messages.at(-1)?.role === "assistant";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-dvh">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 sm:px-6">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title ?? t("newConversation")}</h1>
        <ParticipantsBar participants={participants} online={online} onAdd={() => void openAdd([])} />
        {isOwner ? (
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
        ) : clientName ? (
          // Only the person responsible for the conversation links it to a client.
          <span className="inline-flex max-w-52 items-center gap-1.5 px-2 text-sm">
            <BriefcaseIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{clientName}</span>
          </span>
        ) : null}
        {conversationId ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("conversationActions")}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setSuggesting(true)} disabled={busy || messages.length === 0}>
                <LightbulbIcon />
                {t("proposeMemory")}
              </DropdownMenuItem>
              {isOwner ? (
                <>
                  <DropdownMenuItem onSelect={() => setRenaming(true)}>
                    <PencilIcon />
                    {t("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTransferring(true)} disabled={busy}>
                    <ArrowRightLeftIcon />
                    {tCollab("transfer")}
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                    <Trash2Icon />
                    {t("delete")}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem destructive onSelect={() => setLeaving(true)}>
                  <LogOutIcon />
                  {tCollab("leave")}
                </DropdownMenuItem>
              )}
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
          {props.handover ? <HandoverCard handover={props.handover} className="mb-8" /> : null}
          {messages.length === 0 ? (
            <EmptyChat onPick={(text) => { setInput(text); textarea.current?.focus(); }} />
          ) : (
            <div className="space-y-8">
              {messages.map((m, index) => {
                const previousAnswer = messages.slice(0, index).reverse().find((x) => x.role === "assistant" && x.model && !x.confrontation);
                const switched = m.role === "assistant" && m.model && !m.confrontation && previousAnswer?.model && previousAnswer.model.id !== m.model.id;
                return (
                  <React.Fragment key={m.id}>
                    {switched ? <ModelSwitchDivider provider={m.model!.provider} label={m.model!.label} /> : null}
                    <MessageItem
                      message={m}
                      live={m.id === liveId}
                      isLastAnswer={m.id === lastAnswerId && lastIsAnswer}
                      busy={busy || pendingElsewhere}
                      models={props.models}
                      onRegenerate={(choice) => regenerate(m, choice)}
                      memoryTargets={memoryTargets}
                      conversationId={conversationId}
                      meId={props.me.id}
                      // Who Can Help: colleagues not here yet who may join (access to the linked client).
                      invitable={m.suggestedColleagues.filter((c) => !participantIds.has(c.userId) && props.colleagues.some((x) => x.userId === c.userId))}
                      onInvite={(userId) => void openAdd([userId])}
                      onConfront={confrontHandler(index)}
                      confrontProgress={confrontProgress[m.id]}
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
          {group ? <TypingLine names={typingNames} /> : null}
          <HideBar state={hide} onProtectAndSend={() => void send(hide.payloadProtectingAll())} onSendAnyway={() => void send(hide.payload())} />
          <div
            className={cn(
              "relative rounded-2xl border bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15",
              inputBlocked && "opacity-60",
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!blocked) void addFiles(e.dataTransfer.files);
            }}
          >
            {mentionMatches.length > 0 ? <MentionMenu options={mentionMatches} active={activeMention} onPick={pickMention} /> : null}
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {attachments.map((a) => {
                  const file = hide.files.find((f) => f.key === a.key);
                  return (
                    <AttachmentChip
                      key={a.key}
                      attachment={a}
                      pending={a.uploading}
                      onRemove={a.uploading ? undefined : () => removeAttachment(a)}
                      removeLabel={t("removeAttachment", { name: a.filename })}
                      hideBadge={
                        a.kind === "image" && !a.uploading
                          ? { tone: "muted", label: tHide("imageNotMasked") }
                          : file && file.visible.length > 0
                            ? { tone: "visible", label: tHide("fileToCheck", { count: file.visible.length }) }
                            : file && file.masked.length > 0
                              ? { tone: "protected", label: tHide("fileProtected", { count: file.masked.length }) }
                              : undefined
                      }
                      onOpen={file ? () => setPreviewKey(a.key) : undefined}
                    />
                  );
                })}
              </div>
            ) : null}
            <div className="relative">
              <HideOverlay text={input} state={hide} scrollTop={inputScroll} className={TEXTAREA_LAYOUT} />
              <textarea
                ref={textarea}
                value={input}
                disabled={inputBlocked}
                onChange={(e) => {
                  setInput(e.target.value);
                  setCaret(e.target.selectionStart);
                  setMentionIndex(0);
                  if (group) notifyTyping();
                }}
                onKeyDown={(e) => {
                  if (mentionMatches.length > 0 && !e.nativeEvent.isComposing) {
                    const count = mentionMatches.length;
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex((activeMention + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
                      return;
                    }
                    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                      e.preventDefault();
                      pickMention(mentionMatches[activeMention]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setMentionDismissed(mention?.start ?? null);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onScroll={(e) => setInputScroll(e.currentTarget.scrollTop)}
                // Hide: a click on a red item protects it (green, struck), on a green one leaves it visible;
                // any selected passage can be protected.
                onClick={(e) => {
                  const el = e.currentTarget;
                  if (el.selectionStart === el.selectionEnd) hide.toggleAt(el.selectionStart);
                }}
                onSelect={(e) => {
                  const el = e.currentTarget;
                  setCaret(el.selectionStart);
                  const selected = input.slice(el.selectionStart, el.selectionEnd).trim();
                  hide.setSelection(selected.length >= 2 ? selected : null);
                }}
                rows={1}
                placeholder={group ? tCollab("groupPlaceholder") : t("placeholder")}
                aria-label={group ? tCollab("groupPlaceholder") : t("placeholder")}
                className={cn(
                  TEXTAREA_LAYOUT,
                  // The visible text is drawn by HideOverlay underneath.
                  "relative block max-h-60 w-full resize-none bg-transparent text-transparent caret-foreground outline-none [scrollbar-width:none] selection:bg-brand/25 selection:text-transparent placeholder:text-muted-foreground/80 disabled:cursor-not-allowed",
                )}
              />
            </div>
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
              {group ? (
                <Tooltip content={tCollab("mentionButton")}>
                  <Button variant="ghost" size="icon-sm" aria-label={tCollab("mentionButton")} disabled={inputBlocked} onClick={startMention}>
                    <AtSignIcon />
                  </Button>
                </Tooltip>
              ) : null}
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
              <AutoSwitch state={hide} disabled={inputBlocked} />
              {busy ? (
                <Button size="icon-sm" variant="secondary" aria-label={t("stop")} onClick={stopAnswer} className="rounded-full">
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

      <ConfrontDialog target={confrontTarget} onOpenChange={(open) => !open && setConfrontTarget(null)} onRun={confront} />
      <FilePreview file={hide.files.find((f) => f.key === previewKey) ?? null} state={hide} onClose={() => setPreviewKey(null)} />
      {conversationId ? <ConversationSuggestions open={suggesting} onOpenChange={setSuggesting} conversationId={conversationId} /> : null}
      <AddPeopleDialog
        open={adding !== null}
        onOpenChange={(open) => {
          if (!open) setAdding(null);
        }}
        conversationId={conversationId}
        title={title}
        colleagues={props.colleagues.filter((c) => !participantIds.has(c.userId))}
        messages={messages}
        preselected={adding ?? []}
        onAdded={() => void refreshParticipants()}
      />
      {conversationId ? (
        <TransferDialog
          open={transferring}
          onOpenChange={setTransferring}
          target={{ kind: "conversation", id: conversationId }}
          colleagues={props.colleagues}
          onTransferred={() => {
            chatList.remove(conversationId);
            router.push("/chat");
          }}
        />
      ) : null}
      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{tCollab("leaveTitle")}</DialogTitle>
            <DialogDescription>{tCollab("leaveBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLeaving(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!conversationId) return;
                const result = await leaveConversationAction({ conversationId });
                if (!result.ok) {
                  toast.error(tErrors(result.error));
                  return;
                }
                chatList.remove(conversationId);
                setLeaving(false);
                toast.success(tCollab("left"));
                router.push("/chat");
              }}
            >
              {tCollab("leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

/** Swaps the "pending-user" placeholder for the saved message (Hide: what the AI received, protected spans). */
function confirmPending(
  list: TimelineMessage[],
  saved: { id: string; seq: number; masked: { content: string | null; counts: TimelineMessage["hideCounts"]; spans: Span[] } | null },
): TimelineMessage[] {
  return list
    .filter((m) => m.id !== saved.id)
    .map((m) =>
      m.id === "pending-user"
        ? { ...m, id: saved.id, seq: saved.seq, maskedContent: saved.masked?.content ?? null, hideCounts: saved.masked?.counts ?? null, hideSpans: saved.masked?.spans ?? [] }
        : m,
    );
}

/**
 * Real time: merges reloaded messages. `requested` ids that came back empty are gone for this person
 * (an answer replaced by Regenerate). The answer streaming in this browser and the viewer's own message
 * being sent are left to the stream.
 */
function mergeMessages(list: TimelineMessage[], requested: string[], fresh: TimelineMessage[], live: string | null, meId: string): TimelineMessage[] {
  const next = [...list];
  for (const id of requested) {
    if (id === live) continue;
    const message = fresh.find((m) => m.id === id);
    const index = next.findIndex((m) => m.id === id);
    if (!message) {
      if (index >= 0) next.splice(index, 1);
    } else if (index >= 0) {
      next[index] = message;
    } else if (!(message.role === "user" && message.author?.id === meId && next.some((m) => m.id === "pending-user"))) {
      next.push(message);
    }
  }
  return next.sort((a, b) => a.seq - b.seq);
}
