"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRightLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ImageIcon,
  AtSignIcon,
  LayoutGridIcon,
  BrainIcon,
  BrainCircuitIcon,
  BriefcaseIcon,
  CheckIcon,
  GitBranchIcon,
  LightbulbIcon,
  LogOutIcon,
  WandSparklesIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ATTACHMENT_ACCEPT, ATTACHMENT_TYPES, extensionOf, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from "@/modules/documents/file-types";
import { QuotaBanner } from "@/modules/usage/ui/quota-banner";
import type { QuotaState } from "@/modules/usage/quota";
import { CHAT_REQUEST_ERRORS, type ChatRequestError, type ChatStreamEvent } from "../stream-events";
import type { AttachmentKind, TimelineMessage } from "../types";
import type { RenderKind } from "@/modules/render/formats";
import type { LearningState } from "@/modules/memory/types";
import { splitNdjson } from "../ndjson";
import {
  createConversationAction,
  deleteConversationAction,
  removePendingAttachmentAction,
  renameConversationAction,
  rewindConversationAction,
  setConversationClientAction,
  setConversationFeedMemoryAction,
  setConversationModelAction,
} from "../server/actions";
import { titleFromMessage, useChatList } from "./chat-list";
import { EditableTitle } from "./editable-title";
import { refreshTitleAction } from "../server/title-actions";
import { AttachmentChip, MessageItem, type PeopleLookup } from "./message-item";
import { ModelPicker, type PickerModel } from "./model-picker";
import { ConversationSuggestions } from "@/modules/memory/ui/conversation-suggestions";
import { AutoSwitch, FilePreview, HideBar, HideOverlay, useHideComposer, type HidePayload } from "@/modules/hide/ui/hide-composer";
import { DictationButton } from "@/modules/dictation/ui/dictation-button";
import type { HideMode, HideSettings, Span } from "@/modules/hide/categories";
import { MODEL_CHOICE_AUTO, modelDisplay } from "@/modules/providers/catalog";
import { PROVIDER_IDS, type ProviderId } from "@/modules/providers/types";
import { CastPicker } from "@/modules/avatars/ui/conversation-cast";
import { detectClientMention } from "@/modules/clients/detect";
import { NewClientDialog } from "@/modules/clients/ui/new-client-dialog";
import type { AssistantId } from "@/modules/avatars/assistants";
import { leaveConversationAction, loadParticipantsAction, loadTimelineMessagesAction } from "@/modules/collaboration/server/actions";
import type { Colleague, Handover, Participant } from "@/modules/collaboration/server/queries";
import { AddPeopleDialog, ParticipantsBar, TypingLine } from "@/modules/collaboration/ui/people";
import { TransferDialog } from "@/modules/collaboration/ui/transfer-dialog";
import { HandoverCard } from "@/modules/collaboration/ui/handover-card";
import { filterMentions, MentionMenu, mentionAt, PROVIDER_TOKENS, type MentionOption } from "@/modules/collaboration/ui/mention-menu";
import { mentionsPerson, naturalMention, parseMention, personTokens, type PersonToken } from "@/modules/collaboration/mentions";
import { AppPickerMenu, filterApps, filterShortcuts, usePickerApps, type CreateShortcut } from "@/modules/agents/ui/app-picker";
import { useConversationRealtime } from "@/modules/collaboration/ui/use-conversation-realtime";
import { ConfrontDialog } from "@/modules/confronter/ui/confront-dialog";
import type { ConfrontEstimate } from "@/modules/confronter/server/actions";
import type { Confrontation, ConfrontationProgress } from "@/modules/confronter/types";
import { TurnIntoToolDialog, type ToolEditorContext } from "@/modules/agents/ui/turn-into-tool-dialog";
import { RUN_STORAGE_PREFIX, type PendingRun } from "@/modules/agents/ui/run-form";
import { AgentNotice } from "@/modules/agents/ui/agent-notice";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import type { AgentNotice as AgentNoticeKind } from "@/modules/agents/builtins";
import { artifactsIn, collectArtifacts, editMessage, hasOpenArtifact, type ArtifactVersion } from "@/modules/artifacts/parse";
import { ArtifactsContext, type ArtifactsApi } from "@/modules/artifacts/ui/artifact-card";
import { ArtifactPanel } from "@/modules/artifacts/ui/artifact-panel";
import { ArtifactWorkspace, useStoredWidth } from "@/modules/artifacts/ui/artifact-workspace";

type PendingAttachment = {
  key: string;
  id?: string;
  filename: string;
  kind: AttachmentKind;
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
    /** "Do not feed the memory" when false (automatic client memory, CLAUDE.md §11). */
    feedMemory?: boolean;
    /** This conversation is the sender's own copy, kept after a transfer. */
    copyOf?: { toName: string | null; at: string } | null;
  } | null;
  models: PickerModel[];
  autoEnabled: boolean;
  defaultChoice: string;
  clients: { id: string; name: string }[];
  initialClientId: string | null;
  /** May create restricted clients (the quick "create this client" dialog). */
  canRestrictClients: boolean;
  /** Voice dictation is on for the company. */
  dictation: boolean;
  /** Images (ChatGPT's image model) are on for the company. */
  images?: boolean;
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
  /** The tool or agent this conversation runs (CLAUDE.md §4.6, §4.7). */
  agent: { id: string; name: string; attachments: boolean; allowedModels: string[]; notice: AgentNoticeKind | null; renderKind: RenderKind | null } | null;
  toolEditor: ToolEditorContext;
};

// Shared by the input and the Manual-mode overlay drawn under it: they must wrap text identically.
const TEXTAREA_LAYOUT = "px-4 pt-3.5 pb-2 text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word]";

export function ChatView(props: Props) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const tHide = useTranslations("hide");
  const router = useRouter();
  const tArtifacts = useTranslations("artifacts");
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
  const tApps = useTranslations("apps");
  const tErrors = useTranslations("errors");
  const [participants, setParticipants] = React.useState(props.participants);
  // "Ajouter" dialog, open with these colleagues preselected (Who Can Help's "Inviter").
  const [adding, setAdding] = React.useState<string[] | null>(null);
  const [transferring, setTransferring] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const [turning, setTurning] = React.useState(false);
  // A tool's models only, when it is limited to some.
  const pickerModels = props.agent?.allowedModels.length ? props.models.filter((m) => props.agent!.allowedModels.includes(m.id)) : props.models;
  const canAttach = !props.agent || props.agent.attachments;
  // Video agents: the files of the conversation a composition or an edit plan may use.
  const renderKind = props.agent?.renderKind ?? null;
  const conversationFiles = React.useMemo(() => messages.flatMap((m) => m.attachments), [messages]);
  const [caret, setCaret] = React.useState(0);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [mentionDismissed, setMentionDismissed] = React.useState<number | null>(null);
  // Applis (CLAUDE.md §11): the "Applis" button, or "/" at the start of a message.
  const [appsOpen, setAppsOpen] = React.useState(false);
  const [appIndex, setAppIndex] = React.useState(0);
  const [slashDismissed, setSlashDismissed] = React.useState(false);
  const group = participants.length > 1;
  // A new conversation is the viewer's own; otherwise the participant marked owner.
  const isOwner = participants.length === 0 || participants.some((p) => p.userId === props.me.id && p.role === "owner");
  // Rights in a shared conversation (CLAUDE.md §11): the database enforces them; the screen follows.
  const myRole = participants.find((p) => p.userId === props.me.id)?.role ?? "owner";
  const canManagePeople = myRole === "owner" || myRole === "manager";
  const readOnly = myRole === "reader";
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
  // "Jump to the latest message" appears once the person scrolled up.
  const [awayFromBottom, setAwayFromBottom] = React.useState(false);
  // "Image": the next message asks ChatGPT's image model for an image (also detected from the text).
  const [imageMode, setImageMode] = React.useState(false);
  // While dictating, the recording bar takes the whole toolbar line (nothing overlaps).
  const [dictating, setDictating] = React.useState(false);
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
    // Attached files follow the company's default (Automatic covers them unless someone turns it off).
    initialDocuments: props.hide.defaultModes.includes("automatic") || props.hide.defaultModes.includes("documents"),
    autoCategories: props.hide.autoCategories,
  });

  const blocked = quota?.state === "blocked";
  // In a group, people can still talk to each other without credits; only "@IA" is refused.
  // Read-only participants never write (the database refuses it too).
  const inputBlocked = (blocked && !group) || readOnly;
  // Clients created from this conversation are known right away, before the page data reloads.
  const [createdClients, setCreatedClients] = React.useState<{ id: string; name: string }[]>([]);
  const allClients = React.useMemo(() => [...props.clients, ...createdClients], [props.clients, createdClients]);
  // The "link to a client" menu: a search field once the list gets long.
  const [clientQuery, setClientQuery] = React.useState("");
  const shownClients = React.useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    return q ? allClients.filter((c) => c.name.toLowerCase().includes(q)) : allClients;
  }, [allClients, clientQuery]);
  const clientName = allClients.find((c) => c.id === clientId)?.name ?? null;
  const [creatingClient, setCreatingClient] = React.useState<string | null>(null);
  const [feedMemory, setFeedMemory] = React.useState(props.conversation?.feedMemory ?? true);
  const tMemory = useTranslations("memory");
  const tConscious = useTranslations("consciousness");
  const [clientMentionDismissed, setMentionDismissedClient] = React.useState<string | null>(null);
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

  // Coming back to a conversation: the reading position of this tab, if the person had scrolled up.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const saved = conversationId ? readSession(`${SCROLL_KEY}${conversationId}`) : null;
    if (!el || saved === null) return;
    stickToBottom.current = false;
    el.scrollTop = Number(saved);
    // Mount only: later scrolls are the person's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drafts are kept per conversation in this browser, and come back when the person returns.
  const draftKey = `${DRAFT_KEY}${conversationId ?? "new"}`;
  React.useEffect(() => {
    const timer = window.setTimeout(() => writeLocal(draftKey, input.trim() ? input : null), 400);
    return () => window.clearTimeout(timer);
  }, [draftKey, input]);

  // Keyboard: Esc stops the answer being written; Ctrl/Cmd+Shift+O starts a new conversation.
  const shortcuts = React.useRef<{ stop: () => void; busy: boolean }>({ stop: () => {}, busy: false });
  React.useEffect(() => {
    shortcuts.current = { stop: stopAnswer, busy };
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shortcuts.current.busy && !document.querySelector("[role=dialog],[role=menu]")) {
        e.preventDefault();
        shortcuts.current.stop();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        router.push("/chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

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

  // A tool run: its first message (the filled form) was prepared by the library page. With auto-protect
  // on it is sent right away; otherwise it waits in the input so the person can protect what they want.
  const runKey = props.conversation && props.conversation.messages.length === 0 ? `${RUN_STORAGE_PREFIX}${props.conversation.id}` : null;
  const pendingRun = React.useSyncExternalStore(noSubscription, () => (runKey ? readSession(runKey) : null), () => null);
  const [runText, setRunText] = React.useState<string | null>(null);
  if (pendingRun && runText === null) {
    const run = parseRun(pendingRun);
    setRunText(run.message);
    setInput(run.message);
    // Files given in the form were uploaded already: they go with the first message.
    if (run.attachments.length) setAttachments(run.attachments.map((a) => ({ ...a, key: a.id, uploading: false })));
  }
  const runSent = React.useRef(false);
  // A draft left in this conversation comes back (unless a tool run fills the input).
  const savedDraft = React.useSyncExternalStore(noSubscription, () => readLocal(`${DRAFT_KEY}${props.conversation?.id ?? "new"}`), () => null);
  const [draftRestored, setDraftRestored] = React.useState(false);
  if (!draftRestored && savedDraft && !pendingRun && input === "") {
    setDraftRestored(true);
    setInput(savedDraft);
  }
  React.useEffect(() => {
    if (!runKey || runText === null || runSent.current || input !== runText) return;
    runSent.current = true;
    try {
      sessionStorage.removeItem(runKey);
    } catch {
      // Storage unavailable: nothing to clean.
    }
    if (hide.auto) void send();
  });

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

  // Set once this person hands the conversation over: the page is about to show their copy instead.
  const departed = React.useRef(false);
  const refreshParticipants = React.useCallback(async () => {
    if (!conversationId || departed.current) return;
    const next = await loadParticipantsAction({ conversationId });
    if (departed.current) return;
    // Nobody visible: the viewer no longer has access (transferred or removed from another window).
    if (next.length === 0) {
      if (window.location.pathname === `/chat/${conversationId}`) router.push("/chat");
      return;
    }
    setParticipants(next);
  }, [conversationId, router]);

  // Real time: colleagues' messages and the answers they ask for, as this person may see them.
  const incoming = React.useRef(new Set<string>());
  const myTokenRef = React.useRef<PersonToken | null>(null);
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
          // A colleague mentions this person ("@Olivier"): a short notice, besides the highlighted message.
          const mine = myTokenRef.current;
          const called = mine ? fresh.find((m) => m.role === "user" && m.author && m.author.id !== props.me.id && mentionsPerson(m.content, mine)) : undefined;
          if (called && mounted.current) toast(tCollab("mentionedYou", { name: called.author!.name ?? tCollab("someone") }));
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
    // Named specialists (modules/agents/named-assistants.ts): not inside a conversation started from an app.
    if (!props.agent) options.push({ token: "Albert", aliases: [], provider: null, hint: tCollab("albertHint"), specialist: true });
    return options;
  }, [props.models, modelChoice, tCollab, props.agent]);
  // Colleagues of the conversation as mention tokens ("@Olivier"): the viewer's own is used to notice mentions.
  const tokens = React.useMemo(() => personTokens(participants.map((p) => ({ id: p.userId, name: p.name }))), [participants]);
  const myToken = tokens.get(props.me.id) ?? null;
  React.useEffect(() => {
    myTokenRef.current = myToken;
  }, [myToken]);
  const otherTokens = participants.filter((p) => p.userId !== props.me.id).flatMap((p) => (tokens.get(p.userId) ? [{ ...tokens.get(p.userId)!, person: p }] : []));
  const allMentionOptions: MentionOption[] = group
    ? [...mentionOptions, ...otherTokens.map((o) => ({ token: o.token, aliases: [], provider: null, hint: o.person.name, person: { name: o.person.name, avatarUrl: o.person.avatarUrl } }))]
    : mentionOptions;
  // "@…" opens the list in a group (to call the AI or a colleague) and alone (a model, or Albert).
  const mention = mentionAt(input, caret);
  const mentionMatches =
    mention && mention.start !== mentionDismissed && !allMentionOptions.some((o) => [o.token, ...o.aliases].some((n) => n.toLowerCase() === mention.query.toLowerCase()))
      ? filterMentions(allMentionOptions, mention.query)
      : [];
  const activeMention = Math.min(mentionIndex, Math.max(mentionMatches.length - 1, 0));
  const slash = /^\/[^\s/]*$/.test(input) && !slashDismissed ? input.slice(1) : null;
  const appQuery = slash ?? (appsOpen ? "" : null);
  const pickerApps = usePickerApps(appQuery !== null);
  const appMatches = appQuery === null ? [] : filterApps(pickerApps, appQuery);
  // "/" also offers to start a document, a presentation, a spreadsheet or an image here, in the chat.
  const shortcutMatches = slash !== null && !props.agent ? filterShortcuts(slash, Boolean(props.images)) : [];
  const pickerCount = shortcutMatches.length + appMatches.length;
  const activeApp = Math.min(appIndex, Math.max(pickerCount - 1, 0));

  function closeApps() {
    setAppsOpen(false);
    if (slash !== null) setSlashDismissed(true);
  }

  /** A creation shortcut: the composer gets a starting sentence (or Image mode), the person completes it. */
  function pickShortcut(shortcut: CreateShortcut) {
    setAppsOpen(false);
    if (shortcut === "image") {
      setImageMode(true);
      setInput("");
      requestAnimationFrame(() => textarea.current?.focus());
      return;
    }
    const start = tApps(`shortcutPrompt.${shortcut as Exclude<CreateShortcut, "image">}`);
    setInput(start);
    setCaret(start.length);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(start.length, start.length);
    });
  }

  function pickApp(app: { id: string }) {
    setAppsOpen(false);
    if (slash !== null) setInput("");
    router.push(clientId ? `/apps/${app.id}?client=${clientId}` : `/apps/${app.id}`);
  }

  /** Dictated text follows what was already typed, then the caret waits after it for a read-through. */
  function insertDictation(text: string) {
    insertAtCaret(input.length, input.length, (input && !/\s$/.test(input) ? " " : "") + text);
  }

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

  /**
   * A person's edit of an artifact: posted to the conversation as a new version (masked by Hide like
   * any message, without an AI answer), so the next answer starts from it.
   */
  async function saveArtifactEdit(artifact: ArtifactVersion, body: string): Promise<boolean> {
    if (!conversationId || busy) return false;
    const text = editMessage(tArtifacts("editIntro", { title: artifact.title || tArtifacts(`kind.${artifact.kind}`) }), { ...artifact, body });
    let ok = true;
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
        attachments: [],
        sources: [],
        maskedContent: null,
        hideCounts: null,
        hideSpans: [],
        contextLimited: false,
        suggestedColleagues: [],
        webSources: [],
        confrontation: null,
      },
    ]);
    await stream(
      { conversationId, modelChoice, message: { content: text, attachmentIds: [] }, hide: hide.payload(), silent: true },
      {
        onRefused: () => {
          ok = false;
          setMessages((list) => list.filter((m) => m.id !== "pending-user"));
        },
      },
    );
    if (ok) {
      setOpenArtifact({ key: artifact.key, version: null });
      toast.success(tArtifacts("saved"));
    }
    return ok;
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
    // The sidebar shows that this conversation is being answered, even after leaving it.
    const streamingId = typeof payload.conversationId === "string" ? payload.conversationId : null;
    if (streamingId) chatList.setGenerating(streamingId, true);

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
                  webSources: [],
                  confrontation: options.confrontation ?? null,
                },
              ];
            });
          } else if (event.type === "imaging") {
            const id = currentLive;
            setMessages((list) => list.map((m) => (m.id === id ? { ...m, imaging: true } : m)));
          } else if (event.type === "searching") {
            const id = currentLive;
            setMessages((list) => list.map((m) => (m.id === id ? { ...m, searching: true } : m)));
          } else if (event.type === "delta") {
            const id = currentLive;
            setMessages((list) => list.map((m) => (m.id === id ? { ...m, content: m.content + event.text } : m)));
          } else if (event.type === "done") {
            const id = currentLive;
            restoreReplaced = null;
            setMessages((list) =>
              list.map((m) =>
                m.id === id
                  ? {
                      ...m,
                      status: "complete",
                      searching: false,
                      imaging: false,
                      // Images the answer made: shown in it, like ChatGPT.
                      attachments: event.images?.length
                        ? event.images.map((image) => ({ id: image.id, filename: image.filename, kind: "image" as const, truncated: false, generated: true }))
                        : m.attachments,
                      sources: event.sources ?? [],
                      maskedContent: event.masked ?? null,
                      suggestedColleagues: event.suggestedColleagues ?? [],
                      webSources: event.webSources ?? [],
                      memory: event.memory ?? null,
                      learning: event.learningJobId
                        ? { jobId: event.learningJobId, status: "queued", learned: 0, confirmed: 0, superseded: 0, proposed: 0, keptPrivate: 0, forgotten: false }
                        : null,
                    }
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
      if (streamingId) chatList.setGenerating(streamingId, false);
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
  /**
   * `override`: text sent instead of the input (an edited prompt, or dictation sent with the arrow);
   * `withComposer`: the input's files go with it and the input is emptied (dictation).
   */
  async function send(hidePayload?: HidePayload, override?: string, withComposer = false) {
    if (override === undefined ? !canSend : busy || pendingElsewhere || inputBlocked) return;
    // Without "Masquage auto", items still in red are confirmed before anything is sent.
    if (!hidePayload && override === undefined) {
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
    // Natural mentions (CLAUDE.md §11), typed or dictated: "Coucou Claude, …" calls Claude like "@Claude"
    // would; in a group, "Coucou Olivier, …" mentions Olivier.
    const text = naturalMention((override ?? input).trim(), group ? otherTokens : []);
    // Alone with the AI, naming an assistant hands the conversation to it ("Continue with Claude").
    const named = !group ? parseMention(text) : null;
    let choice = modelChoice;
    if (named && named !== "selected") {
      const usable = props.models.filter((m) => m.provider === named && m.available);
      const target = usable.find((m) => m.tier === "balanced") ?? usable[0];
      if (target && target.id !== modelChoice) {
        choice = target.id;
        setModelChoice(target.id);
      }
    }
    const ready = override === undefined || withComposer ? attachments.filter((a) => a.id) : [];
    const id = await ensureConversation();
    if (!id) return;

    if (override === undefined || withComposer) {
      setInput("");
      setAttachments([]);
      setImageMode(false);
      // The draft is sent: forget it (also the one of the "new conversation" screen).
      writeLocal(`${DRAFT_KEY}new`, null);
      writeLocal(`${DRAFT_KEY}${id}`, null);
    }
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
        webSources: [],
        confrontation: null,
      },
    ]);
    if (!title && text) {
      const derived = titleFromMessage(text);
      setTitle(derived);
      chatList.upsert({ id, title: derived, clientId, clientName });
    }

    await stream(
      {
        conversationId: id,
        modelChoice: choice,
        message: { content: text, attachmentIds: ready.map((a) => a.id) },
        hide: hideChoices,
        ...(imageMode ? { image: true } : {}),
      },
      {
        // Refused before anything was saved: give the user their text and files back.
        onRefused: () => {
          setMessages((list) => list.filter((m) => m.id !== "pending-user"));
          setInput(text);
          setAttachments(ready);
        },
      },
    );
    // Automatic title (like ChatGPT or Claude), once the AI has answered: kept unless renamed by hand.
    if (!group || parseMention(text)) {
      void refreshTitleAction({ conversationId: id }).then((result) => {
        if (!result || !mounted.current) return;
        setTitle(result.title);
        chatList.upsert({ id, title: result.title });
      });
    }
  }

  /** Edit an earlier prompt: it and what follows are set aside on the server, then the new version is sent. */
  async function editPrompt(message: TimelineMessage, text: string) {
    if (!conversationId || busy) return;
    const result = await rewindConversationAction({ messageId: message.id });
    if (!result.ok) return void toast.error(result.error === "validation" ? t("editUnavailable") : tErrors(result.error));
    setMessages((list) => list.filter((m) => m.seq < message.seq));
    await send(undefined, text);
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

  function changeModel(choice: string) {
    setModelChoice(choice);
    if (conversationId) void setConversationModelAction({ conversationId, modelChoice: choice });
  }

  async function toggleFeedMemory() {
    if (!conversationId) return setFeedMemory((v) => !v);
    const next = !feedMemory;
    setFeedMemory(next);
    const result = await setConversationFeedMemoryAction({ conversationId, feed: next });
    if (!result.ok) {
      setFeedMemory(!next);
      toast.error(tErrors(result.error));
    }
  }

  /** Links the conversation to a client, or unlinks it (null). A new chat is linked when it is created. */
  async function changeClient(next: string | null, nextName?: string) {
    const previous = clientId;
    const previousName = clientName;
    setClientId(next);
    if (!conversationId) return;
    const result = await setConversationClientAction({ conversationId, clientId: next });
    if (!result.ok) {
      setClientId(previous);
      toast.error(result.error === "no_client_access" ? tErrors("no_client_access") : t("clientLinkFailed"));
      return;
    }
    chatList.upsert({ id: conversationId, clientId: next, clientName: next ? (nextName ?? allClients.find((c) => c.id === next)?.name ?? null) : null });
    if (!next && previousName) toast.success(t("clientUnlinked", { name: previousName }));
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

  const memoryTargets = React.useMemo(
    () => [...props.memoryTargets].sort((a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId)),
    [props.memoryTargets, clientId],
  );
  // A client named in an unlinked conversation: suggest linking it, or creating it (CLAUDE.md §11).
  const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const clientMention = !clientId && isOwner ? detectClientMention(`${lastUserText}\n${input}`, allClients) : null;
  const mentionKey = clientMention ? (clientMention.kind === "link" ? clientMention.id : `new:${clientMention.name.toLowerCase()}`) : null;
  const showMention = clientMention !== null && mentionKey !== clientMentionDismissed;

  // The assistant picked for the next answer (shown on the empty conversation).
  const selectedAssistant: AssistantId =
    modelChoice === MODEL_CHOICE_AUTO ? "auto" : (props.models.find((m) => m.id === modelChoice)?.provider ?? "auto");
  // Artifacts (documents, spreadsheets, slides, code) and the workspace on the right.
  const artifactVersions = React.useMemo(
    () => collectArtifacts(messages.filter((m) => m.id !== "pending-user").map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt }))),
    [messages],
  );
  const [openArtifact, setOpenArtifact] = React.useState<{ key: string; version: number | null } | null>(null);
  const workspaceVersions = openArtifact ? artifactVersions.get(openArtifact.key) : undefined;
  const workspace = openArtifact && workspaceVersions?.length ? { versions: workspaceVersions, version: openArtifact.version } : null;
  const setWorkspace = (update: ((w: { version: number | null } | null) => { version: number | null } | null) | null) =>
    setOpenArtifact((current) => {
      if (update === null || !current) return null;
      const next = update({ version: current.version });
      return next ? { ...current, version: next.version } : null;
    });
  const liveContent = liveId ? (messages.find((m) => m.id === liveId)?.content ?? "") : "";
  const workspaceUpdating = busy && hasOpenArtifact(liveContent);
  const [workspaceWidth, setWorkspaceWidth] = useStoredWidth();
  const artifactsApi = React.useMemo<ArtifactsApi>(
    () => ({ versions: artifactVersions, openKey: openArtifact?.key ?? null, open: (key, version) => setOpenArtifact({ key, version: version ?? null }) }),
    [artifactVersions, openArtifact?.key],
  );
  // When an answer is finished, the last artifact it wrote opens (its newest version).
  const finishedLive = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (liveId) {
      finishedLive.current = liveId;
      return;
    }
    const done = finishedLive.current;
    finishedLive.current = null;
    if (!done) return;
    const answer = messages.find((m) => m.id === done);
    const last = answer ? artifactsIn(answer.content).at(-1) : undefined;
    if (last) setOpenArtifact({ key: last.key, version: null });
  }, [liveId, messages]);

  const people: PeopleLookup = React.useMemo(() => new Map(participants.map((p) => [p.userId, { name: p.name, avatarUrl: p.avatarUrl }])), [participants]);
  // The timeline below is drawn again only when what it shows changes (typing does not redraw it).
  const participantKey = participants.map((p) => p.userId).join(",");
  const renderInfo = React.useMemo(() => (renderKind ? { kind: renderKind, attachments: conversationFiles } : null), [renderKind, conversationFiles]);
  const actionsRef = React.useRef<TimelineActions | null>(null);
  React.useEffect(() => {
    actionsRef.current = {
      regenerate: (m, choice) => regenerate(m, choice),
      invite: (userId) => void openAdd([userId]),
      confront: (question) => conversationId && setConfrontTarget({ conversationId, messageId: question.id, excerpt: question.content.slice(0, 200) }),
      learning: (id, state) => setMessages((list) => list.map((x) => (x.id === id ? { ...x, learning: state } : x))),
      edit: (m, text) => void editPrompt(m, text),
    };
  });
  const timelineActions = React.useMemo<TimelineActions>(
    () => ({
      regenerate: (m, choice) => actionsRef.current?.regenerate(m, choice),
      invite: (userId) => actionsRef.current?.invite(userId),
      confront: (question) => actionsRef.current?.confront(question),
      learning: (id, state) => actionsRef.current?.learning(id, state),
      edit: (m, text) => actionsRef.current?.edit(m, text),
    }),
    [],
  );
  const castOptions: AssistantId[] = [
    ...PROVIDER_IDS.filter((provider) => pickerModels.some((m) => m.provider === provider && m.available)),
    ...(props.autoEnabled && !props.agent?.allowedModels.length ? (["auto"] as const) : []),
  ];
  function pickAssistant(id: AssistantId) {
    if (id === "auto") return changeModel(MODEL_CHOICE_AUTO);
    if (props.models.find((m) => m.id === modelChoice)?.provider === id) return;
    const first = pickerModels.find((m) => m.provider === (id as ProviderId) && m.available);
    if (first) changeModel(first.id);
  }


  return (
    <ArtifactsContext.Provider value={artifactsApi}>
    <div className="flex h-[calc(100dvh-3.5rem)] md:h-dvh">
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--glass-border)] px-4 sm:px-6">
        <EditableTitle
          conversationId={conversationId}
          title={title}
          placeholder={t("newConversation")}
          canEdit={!readOnly}
          onRenamed={(next) => {
            setTitle(next);
            if (conversationId && next) chatList.upsert({ id: conversationId, title: next });
          }}
        />
        {props.agent ? (
          <Link
            href={`/apps/${props.agent.id}`}
            className="hidden max-w-48 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            <WandSparklesIcon className="size-3.5 shrink-0 text-brand" />
            <span className="truncate">{props.agent.name}</span>
          </Link>
        ) : null}
        <ParticipantsBar
          participants={participants}
          online={online}
          onAdd={() => void openAdd([])}
          canManage={canManagePeople}
          conversationId={conversationId}
          meId={props.me.id}
          onChanged={() => void refreshParticipants()}
        />
        {showMention && clientMention ? (
          <span className="animate-nudge inline-flex h-8 max-w-64 items-center gap-0.5 rounded-full border border-brand/40 bg-brand-soft pr-1 pl-3 text-[13px]">
            <button
              type="button"
              className="truncate font-medium text-foreground"
              onClick={() => (clientMention.kind === "link" ? void changeClient(clientMention.id) : setCreatingClient(clientMention.name))}
            >
              {clientMention.kind === "link" ? t("linkSuggestion", { name: clientMention.name }) : t("createClientSuggestion", { name: clientMention.name })}
            </button>
            <button
              type="button"
              aria-label={t("dismissSuggestion")}
              onClick={() => setMentionDismissedClient(mentionKey)}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {"×"}
            </button>
          </span>
        ) : null}
        {isOwner ? (
          <DropdownMenu onOpenChange={(open) => !open && setClientQuery("")}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={cn("max-w-32 gap-1.5 text-muted-foreground sm:max-w-52", clientName && "text-foreground")}>
                <BriefcaseIcon />
                {/* On a phone, an unlinked conversation shows the icon only (the title needs the room). */}
                <span className={cn("truncate", !clientName && "sr-only sm:not-sr-only")}>{clientName ?? t("linkClient")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {allClients.length > 6 ? (
                <div className="p-1 pb-1.5">
                  <Input
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    // Typing goes to the field, not to the menu's type-to-select.
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder={t("clientSearch")}
                    aria-label={t("clientSearch")}
                    className="h-8 text-[13px]"
                  />
                </div>
              ) : null}
              {allClients.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {shownClients.map((c) => (
                    <DropdownMenuItem key={c.id} onSelect={() => void changeClient(c.id, c.name)}>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.id === clientId ? <CheckIcon className="text-brand" /> : null}
                    </DropdownMenuItem>
                  ))}
                  {shownClients.length === 0 ? <p className="px-2 py-1.5 text-[13px] text-muted-foreground">{t("clientNoMatch")}</p> : null}
                </div>
              ) : null}
              {allClients.length > 0 ? <DropdownMenuSeparator /> : null}
              {/* Not linked: create a client and link it at once. Linked: detach the conversation from it. */}
              {clientId ? (
                <DropdownMenuItem onSelect={() => void changeClient(null)}>
                  <UnlinkIcon />
                  <span className="truncate">{t("unlinkClient", { name: clientName ?? "" })}</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setCreatingClient(clientQuery.trim())}>
                  <PlusIcon />
                  {t("newClient")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : clientName ? (
          // Only the person responsible for the conversation links it to a client.
          <span className="inline-flex max-w-52 items-center gap-1.5 px-2 text-sm">
            <BriefcaseIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{clientName}</span>
          </span>
        ) : null}
        {clientId && clientName ? (
          // Cendr Consciousness: whether this conversation teaches the client's memory (owner switches it).
          <Tooltip content={feedMemory ? tConscious("learningOnHint", { client: clientName }) : tConscious("learningOffHint")}>
            <button
              type="button"
              data-testid="learning-state"
              disabled={!isOwner}
              onClick={() => void toggleFeedMemory()}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs transition-colors duration-150 enabled:hover:bg-muted",
                feedMemory ? "text-brand" : "text-muted-foreground",
              )}
            >
              {feedMemory ? <BrainIcon className="size-3.5" /> : <BrainCircuitIcon className="size-3.5 opacity-60" />}
              <span className="hidden sm:inline">{feedMemory ? tConscious("learningOn") : tConscious("learningOff")}</span>
            </button>
          </Tooltip>
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
              {isOwner && clientId ? (
                <DropdownMenuItem onSelect={() => void toggleFeedMemory()}>
                  <BrainIcon />
                  {feedMemory ? tMemory("feedOff") : tMemory("feedOn")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setTurning(true)} disabled={busy || !messages.some((m) => m.role === "assistant" && m.status === "complete")}>
                <WandSparklesIcon />
                {tCollab("turnIntoTool")}
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
          if (awayFromBottom === stickToBottom.current) setAwayFromBottom(!stickToBottom.current);
          // Reading position kept for this tab: coming back to the conversation reopens it there.
          if (conversationId) writeSession(`${SCROLL_KEY}${conversationId}`, stickToBottom.current ? null : String(Math.round(el.scrollTop)));
        }}
      >
        <div className="w-full">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          {props.conversation?.copyOf ? <CopyBanner copyOf={props.conversation.copyOf} /> : null}
          {props.handover ? <HandoverCard handover={props.handover} className="mb-8" /> : null}
          {props.agent?.notice ? <AgentNotice notice={props.agent.notice} className="mb-6" /> : null}
          {messages.length === 0 ? (
            <EmptyChat
              onPick={(text) => {
                setInput(text);
                textarea.current?.focus();
              }}
              cast={castOptions.length > 1 ? { options: castOptions, selected: selectedAssistant, onSelect: pickAssistant } : null}
            />
          ) : (
            <ChatTimeline
              messages={messages}
              liveId={liveId}
              busy={busy || pendingElsewhere}
              models={props.models}
              memoryTargets={memoryTargets}
              conversationId={conversationId}
              meId={props.me.id}
              participantKey={participantKey}
              colleagues={props.colleagues}
              confrontProgress={confrontProgress}
              renderInfo={renderInfo}
              people={people}
              group={group}
              myToken={myToken}
              editable={!group && !readOnly && !props.agent}
              actions={timelineActions}
            />
          )}
        </div>
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
          {readOnly ? (
            <p role="status" className="rounded-lg bg-muted px-3 py-2 text-center text-[13px] text-muted-foreground">
              {tCollab("readOnlyNotice")}
            </p>
          ) : null}
          {group ? <TypingLine names={typingNames} /> : null}
          {awayFromBottom && messages.length > 0 ? (
            <div className="pointer-events-none relative h-0">
              <button
                type="button"
                data-testid="jump-to-latest"
                aria-label={t("jumpToLatest")}
                title={t("jumpToLatest")}
                onClick={() => {
                  const el = scrollRef.current;
                  stickToBottom.current = true;
                  setAwayFromBottom(false);
                  el?.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                }}
                className="pointer-events-auto absolute -top-14 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground animate-message-in"
              >
                <ArrowDownIcon className="size-4" />
              </button>
            </div>
          ) : null}
          <HideBar state={hide} onProtectAndSend={() => void send(hide.payloadProtectingAll())} onSendAnyway={() => void send(hide.payload())} />
          <LiquidGlass
            material="panel"
            reach={34}
            className={cn(
              "relative rounded-[22px] border transition-[border-color,box-shadow] duration-[var(--dur-micro)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15",
              inputBlocked && "opacity-60",
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!blocked && canAttach) void addFiles(e.dataTransfer.files);
            }}
            onPaste={(e) => {
              // Pasted files and screenshots are attached like dropped ones; pasted text stays text.
              if (e.clipboardData.files.length > 0 && !blocked && canAttach) {
                e.preventDefault();
                void addFiles(e.clipboardData.files);
              }
            }}
          >
            {mentionMatches.length > 0 ? <MentionMenu options={mentionMatches} active={activeMention} onPick={pickMention} /> : null}
            {appQuery !== null ? <AppPickerMenu apps={appMatches} shortcuts={shortcutMatches} loading={pickerApps === null} active={activeApp} onPick={pickApp} onShortcut={pickShortcut} /> : null}
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
                  setAppIndex(0);
                  if (!e.target.value.startsWith("/")) setSlashDismissed(false);
                  if (group) notifyTyping();
                }}
                onKeyDown={(e) => {
                  if (appQuery !== null && !e.nativeEvent.isComposing) {
                    const count = pickerCount;
                    if (count > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                      e.preventDefault();
                      setAppIndex((activeApp + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
                      return;
                    }
                    if (count > 0 && ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab")) {
                      e.preventDefault();
                      if (activeApp < shortcutMatches.length) pickShortcut(shortcutMatches[activeApp]);
                      else pickApp(appMatches[activeApp - shortcutMatches.length]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeApps();
                      return;
                    }
                  }
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
                placeholder={imageMode ? t("imagePlaceholder") : group ? tCollab("groupPlaceholder") : t("placeholder")}
                aria-label={group ? tCollab("groupPlaceholder") : t("placeholder")}
                className={cn(
                  TEXTAREA_LAYOUT,
                  // The visible text is drawn by HideOverlay underneath.
                  "relative block max-h-60 w-full resize-none bg-transparent text-transparent caret-foreground outline-none [scrollbar-width:none] selection:bg-brand/25 selection:text-transparent placeholder:text-muted-foreground/80 disabled:cursor-not-allowed",
                )}
              />
            </div>
            {/* A container: in a narrow composer (workspace open, small window) labels give way to icons. */}
            <div className={cn("@container flex min-w-0 items-center gap-1 px-2 pb-2", dictating && "[&>*:not([data-dictation])]:hidden")}>
              {canAttach ? (
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
              ) : null}
              {props.dictation ? (
                <DictationButton
                  disabled={inputBlocked}
                  onText={insertDictation}
                  // The send arrow: what was typed, then the dictated text, sent at once.
                  onSend={(text) => void send(undefined, `${input.trim()}${input.trim() ? " " : ""}${text}`, true)}
                  onRecordingChange={setDictating}
                />
              ) : null}
              <Tooltip content={tApps("picker")}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tApps("picker")}
                  aria-expanded={appQuery !== null}
                  disabled={inputBlocked}
                  onClick={() => {
                    setAppIndex(0);
                    setAppsOpen((open) => !open);
                    textarea.current?.focus();
                  }}
                >
                  <LayoutGridIcon />
                </Button>
              </Tooltip>
              {props.images && !props.agent ? (
                <Tooltip content={t("imageModeHint")}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={imageMode}
                    disabled={inputBlocked}
                    onClick={() => {
                      setImageMode((on) => !on);
                      textarea.current?.focus();
                    }}
                    className={cn("h-8 gap-1.5 px-2", imageMode && "bg-brand-soft text-brand hover:bg-brand-soft")}
                  >
                    <ImageIcon />
                    <span className={cn(!imageMode && "sr-only")}>{t("imageMode")}</span>
                  </Button>
                </Tooltip>
              ) : null}
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
              <ModelPicker
                value={modelChoice}
                onChange={changeModel}
                models={pickerModels}
                autoEnabled={props.autoEnabled && !props.agent?.allowedModels.length}
                disabled={busy}
              />
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
          </LiquidGlass>
          <p className="text-center text-[11px] text-muted-foreground/80">{props.fakeMode ? t("fakeMode") : t("disclaimer")}</p>
        </div>
      </div>

      <NewClientDialog
        open={creatingClient !== null}
        onOpenChange={(open) => !open && setCreatingClient(null)}
        canRestrict={props.canRestrictClients}
        defaultName={creatingClient ?? undefined}
        linkConversationId={conversationId ?? undefined}
        onCreated={(id, name) => {
          setCreatedClients((list) => [...list, { id, name }]);
          void changeClient(id, name);
        }}
      />
      <ConfrontDialog target={confrontTarget} onOpenChange={(open) => !open && setConfrontTarget(null)} onRun={confront} />
      <FilePreview file={hide.files.find((f) => f.key === previewKey) ?? null} state={hide} onClose={() => setPreviewKey(null)} />
      {conversationId ? <ConversationSuggestions open={suggesting} onOpenChange={setSuggesting} conversationId={conversationId} /> : null}
      {conversationId ? <TurnIntoToolDialog conversationId={conversationId} open={turning} onOpenChange={setTurning} editor={props.toolEditor} /> : null}
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
          onTransferred={(copyId) => {
            // The conversation forked: the sender continues in their own copy (CLAUDE.md §11).
            departed.current = true;
            chatList.remove(conversationId);
            if (copyId) chatList.upsert({ id: copyId, title, clientId, clientName, kind: "copy" });
            router.push(copyId ? `/chat/${copyId}` : "/chat");
            router.refresh();
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
    {workspace ? (
      <ArtifactWorkspace
        width={workspaceWidth}
        onWidth={setWorkspaceWidth}
        onClose={() => setWorkspace(null)}
        panel={
          <ArtifactPanel
            versions={workspace.versions}
            version={workspace.version}
            onVersion={(version) => setWorkspace((w) => (w ? { ...w, version } : w))}
            onClose={() => setWorkspace(null)}
            onSave={saveArtifactEdit}
            canEdit={Boolean(conversationId) && !readOnly && !busy}
            updating={workspaceUpdating}
          />
        }
      />
    ) : null}
    </div>
    </ArtifactsContext.Provider>
  );
}

/** At the top of the sender's copy after a transfer: where it comes from, and what each side sees. */
function CopyBanner({ copyOf }: { copyOf: { toName: string | null; at: string } }) {
  const tCollab = useTranslations("collaboration");
  const format = useFormatter();
  const date = format.dateTime(new Date(copyOf.at), { dateStyle: "long" });
  return (
    <div role="note" className="mb-8 flex items-start gap-3 glass-standard rounded-xl border px-4 py-3 text-[13px] text-muted-foreground">
      <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-brand" />
      <p>{copyOf.toName ? tCollab("copyBanner", { name: copyOf.toName, date }) : tCollab("copyBannerUnknown", { date })}</p>
    </div>
  );
}

function EmptyChat({
  onPick,
  cast,
}: {
  onPick: (text: string) => void;
  cast: { options: AssistantId[]; selected: AssistantId; onSelect: (id: AssistantId) => void } | null;
}) {
  const t = useTranslations("chat");
  const suggestions = [t("suggestion1"), t("suggestion2"), t("suggestion3")];
  return (
    <div className="flex min-h-[52vh] flex-col items-center justify-center text-center">
      {cast ? <CastPicker options={cast.options} selected={cast.selected} onSelect={cast.onSelect} /> : null}
      <h2 className={cn("text-2xl font-semibold tracking-[-0.025em] sm:text-[2rem]", cast && "mt-10")}>{t("emptyTitle")}</h2>
      <p className="mt-3 max-w-md text-[15px] text-muted-foreground">{t("emptyBody")}</p>
      <div className="mt-8 flex max-w-xl flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-full border bg-card/60 px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
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

const noSubscription = () => () => {};

/** A pending run as stored by the library page (older entries were the message alone). */
function parseRun(raw: string): PendingRun {
  try {
    const value = JSON.parse(raw) as Partial<PendingRun>;
    if (typeof value?.message === "string") return { message: value.message, attachments: Array.isArray(value.attachments) ? value.attachments : [] };
  } catch {
    // Not JSON: the message itself.
  }
  return { message: raw, attachments: [] };
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const SCROLL_KEY = "cendr-scroll:";
const DRAFT_KEY = "cendr-draft:";

/** Session storage write (null removes); storage can be refused (private mode). */
function writeSession(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Not kept: nothing else changes.
  }
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value.slice(0, 20_000));
  } catch {
    // Not kept: the draft only lives in the page.
  }
}

type TimelineActions = {
  regenerate: (message: TimelineMessage, choice?: string) => void;
  invite: (userId: string) => void;
  confront: (question: TimelineMessage) => void;
  learning: (messageId: string, state: LearningState) => void;
  edit: (message: TimelineMessage, text: string) => void;
};

/**
 * The conversation's messages. Memoised: typing in the input, the Hide check or the header do not
 * draw it again; only new messages, a streamed word, or a change of rights do.
 */
const ChatTimeline = React.memo(function ChatTimeline({
  messages,
  liveId,
  busy,
  models,
  memoryTargets,
  conversationId,
  meId,
  participantKey,
  colleagues,
  confrontProgress,
  renderInfo,
  people,
  group,
  myToken,
  editable,
  actions,
}: {
  messages: TimelineMessage[];
  liveId: string | null;
  busy: boolean;
  models: PickerModel[];
  memoryTargets: Props["memoryTargets"];
  conversationId: string | null;
  meId: string;
  participantKey: string;
  colleagues: Colleague[];
  confrontProgress: Record<string, ConfrontationProgress>;
  renderInfo: { kind: RenderKind; attachments: TimelineMessage["attachments"] } | null;
  people: PeopleLookup;
  group: boolean;
  myToken: PersonToken | null;
  editable: boolean;
  actions: TimelineActions;
}) {
  const participantIds = new Set(participantKey ? participantKey.split(",") : []);
  const lastAnswerId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const lastIsAnswer = messages.at(-1)?.role === "assistant";
  return (
    <div className="space-y-8">
      {messages.map((m, index) => {
        // The question a "Confronter" button refers to: the message itself, or the question an answer replies to.
        const question = m.role === "user" ? m : messages.slice(0, index).reverse().find((x) => x.role === "user");
        const canConfront = conversationId && question && question.id !== "pending-user" && question.content.trim() && !busy;
        return (
          <MessageItem
            key={m.id}
            message={m}
            live={m.id === liveId}
            isLastAnswer={m.id === lastAnswerId && lastIsAnswer}
            busy={busy}
            models={models}
            onRegenerate={(choice) => actions.regenerate(m, choice)}
            memoryTargets={memoryTargets}
            conversationId={conversationId}
            meId={meId}
            // Who Can Help: colleagues not here yet who may join (access to the linked client).
            invitable={m.suggestedColleagues.filter((c) => !participantIds.has(c.userId) && colleagues.some((x) => x.userId === c.userId))}
            onInvite={(userId) => actions.invite(userId)}
            onConfront={canConfront ? () => actions.confront(question) : undefined}
            confrontProgress={confrontProgress[m.id]}
            onLearning={(state) => actions.learning(m.id, state)}
            onEdit={
              editable && m.role === "user" && (!m.author || m.author.id === meId) && !m.id.startsWith("pending") ? (text) => actions.edit(m, text) : undefined
            }
            render={renderInfo}
            people={people}
            group={group}
            myToken={myToken}
            pdfAsked={m.role === "assistant" && /\bpdf\b/i.test(question?.content ?? "")}
          />
        );
      })}
    </div>
  );
});
