"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircleIcon,
  BookmarkPlusIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  FilmIcon,
  GlobeIcon,
  ImageIcon,
  PencilIcon,
  RefreshCwIcon,
  ScaleIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { modelDisplay } from "@/modules/providers/catalog";
import { PROVIDER_ERROR_CODES, type ProviderErrorCode } from "@/modules/providers/types";
import { cn } from "@/lib/utils";
import type { AttachmentKind, TimelineMessage } from "../types";
import type { RenderKind } from "@/modules/render/formats";
import { RenderPanel } from "@/modules/render/ui/render-panel";

type RenderProps = { kind: RenderKind; attachments: { id: string; filename: string; kind: AttachmentKind }[] };
import type { SuggestedColleague } from "../stream-events";
import { Markdown } from "./markdown";
import type { PickerModel } from "./model-picker";
import { ModelName, ProviderDot } from "./provider-mark";
import { AssistantAvatar } from "@/modules/avatars/ui/assistant-avatar";
import type { AssistantState } from "@/modules/avatars/assistants";
import { SourceList, SourceSheet } from "@/modules/memory/ui/source-proof";
import { MemoryLine } from "@/modules/memory/ui/memory-line";
import type { LearningState } from "@/modules/memory/types";
import { EntryDialog, type MemoryTarget } from "@/modules/memory/ui/entry-dialog";
import { MaskedView } from "@/modules/hide/ui/masked-view";
import { ProtectedText } from "@/modules/hide/ui/hide-composer";
import { mentionsPerson, type PersonToken } from "@/modules/collaboration/mentions";
import { ConfrontationView } from "@/modules/confronter/ui/confrontation-view";
import type { ConfrontationProgress } from "@/modules/confronter/types";
import { hasTable } from "@/modules/exports/blocks";

type MemoryProps = { memoryTargets: MemoryTarget[]; conversationId: string | null };

/** Who Can Help: colleagues the answer suggests who are not in the conversation yet. */
type InviteProps = { invitable?: SuggestedColleague[]; onInvite?: (userId: string) => void };

/** Confronter: opens the confirmation for this question (or the question this answer replies to). */
type ConfrontProps = { onConfront?: () => void; confrontProgress?: ConfrontationProgress };

/** Cendr Consciousness: the answer's learning changed state (polled under the answer). */
type LearningProps = { onLearning?: (state: LearningState) => void };

/** Edit one's own earlier prompt and run it again. */
type EditProps = { onEdit?: (text: string) => void };

/** Avatars of the people in the conversation, by user id (colleagues' messages show theirs). */
export type PeopleLookup = Map<string, { name: string; avatarUrl: string | null }>;

export function MessageItem({
  message,
  live,
  isLastAnswer,
  busy,
  models,
  onRegenerate,
  memoryTargets,
  conversationId,
  meId,
  invitable,
  onInvite,
  onConfront,
  confrontProgress,
  onLearning,
  onEdit,
  render,
  people,
  group = false,
  myToken = null,
  pdfAsked = false,
}: {
  message: TimelineMessage;
  people?: PeopleLookup;
  /** Group conversation: the AI's answers sit in a bubble on the left, like colleagues'. */
  group?: boolean;
  /** The viewer as a mention token: their mentions are highlighted. */
  myToken?: PersonToken | null;
  /** The question asked for a PDF: a visible download button under the answer. */
  pdfAsked?: boolean;
  /** Video agents: the answer may hold a composition or an edit plan to make into MP4s. */
  render?: RenderProps | null;
  /** The answer is streaming right now in this browser. */
  live?: boolean;
  isLastAnswer: boolean;
  busy: boolean;
  models: PickerModel[];
  onRegenerate: (modelChoice?: string) => void;
  /** The viewer: their messages are on the right, colleagues' on the left with their name. */
  meId: string;
} & MemoryProps &
  InviteProps &
  ConfrontProps &
  LearningProps &
  EditProps) {
  if (message.role === "user") {
    const mine = !message.author || message.author.id === meId;
    return (
      <UserMessage
        message={message}
        mine={mine}
        mentionsMe={!mine && myToken !== null && mentionsPerson(message.content, myToken)}
        avatarUrl={message.author ? (people?.get(message.author.id)?.avatarUrl ?? null) : null}
        memoryTargets={memoryTargets}
        conversationId={conversationId}
        onConfront={onConfront}
        onEdit={onEdit}
      />
    );
  }
  return (
    <AssistantMessage
      message={message}
      live={live}
      isLastAnswer={isLastAnswer}
      busy={busy}
      models={models}
      onRegenerate={onRegenerate}
      memoryTargets={memoryTargets}
      conversationId={conversationId}
      invitable={invitable}
      onInvite={onInvite}
      onConfront={onConfront}
      confrontProgress={confrontProgress}
      onLearning={onLearning}
      render={render}
      bubble={group}
      pdfAsked={pdfAsked}
    />
  );
}

/** "@Claude", "@Olivier": shown in the accent colour inside a message. */
function withMentions(text: string, key: string): React.ReactNode {
  const parts = text.split(/((?:^|(?<=[\s(,;:"«]))@[\p{L}][\p{L}\p{N}_-]*)/u);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={`${key}-${i}`} className="font-medium text-brand">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Colleagues' bubbles: one soft tint per person, distinct from the AI's neutral bubble. */
const PERSON_TINTS = ["--pastel-sky", "--pastel-mint", "--pastel-peach", "--pastel-lavender"];
function personTint(id: string | undefined): React.CSSProperties {
  let hash = 0;
  for (const c of id ?? "") hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const token = PERSON_TINTS[hash % PERSON_TINTS.length];
  return {
    backgroundColor: `color-mix(in oklch, var(${token}) 16%, var(--card))`,
    borderColor: `color-mix(in oklch, var(${token}) 38%, transparent)`,
  };
}

function ConfrontButton({ onConfront, className }: { onConfront?: () => void; className?: string }) {
  const t = useTranslations("confronter");
  if (!onConfront) return null;
  return (
    <Tooltip content={t("buttonHint")}>
      <Button variant="ghost" size="icon-sm" aria-label={t("button")} className={className} onClick={onConfront}>
        <ScaleIcon />
      </Button>
    </Tooltip>
  );
}

/** "Save to memory": a person deliberately keeps a message (edited if needed) in a memory they can write. */
function SaveToMemory({ message, memoryTargets, conversationId, className }: { message: TimelineMessage } & MemoryProps & { className?: string }) {
  const t = useTranslations("chat");
  const [open, setOpen] = React.useState(false);
  if (!conversationId || memoryTargets.length === 0 || !message.content || message.id === "pending-user") return null;
  const firstLine = message.content.split("\n").find((l) => l.trim())?.replace(/^[#>*\-\s]+/, "").slice(0, 80) ?? "";
  return (
    <>
      <Tooltip content={t("saveToMemory")}>
        <Button variant="ghost" size="icon-sm" aria-label={t("saveToMemory")} className={className} onClick={() => setOpen(true)}>
          <BookmarkPlusIcon />
        </Button>
      </Tooltip>
      <EntryDialog
        open={open}
        onOpenChange={setOpen}
        targets={memoryTargets}
        initial={{ title: firstLine, content: message.content.replace(/\[S\d{1,2}\]/g, "") }}
        source={{ conversationId, messageId: message.id }}
      />
    </>
  );
}

function UserMessage({
  message,
  mine,
  mentionsMe = false,
  avatarUrl,
  memoryTargets,
  conversationId,
  onConfront,
  onEdit,
}: { message: TimelineMessage; mine: boolean; mentionsMe?: boolean; avatarUrl: string | null; onEdit?: (text: string) => void } & MemoryProps & ConfrontProps) {
  const hover = "mt-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/user:opacity-100";
  const t = useTranslations("collaboration");
  const tChat = useTranslations("chat");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(message.content);
  const [copied, setCopied] = React.useState(false);
  if (!mine) {
    // A colleague's message (group conversation, or a conversation taken over after a transfer).
    const name = message.author?.name ?? t("someone");
    return (
      <div className="group/user flex animate-message-in flex-col items-start gap-2">
        <div className="flex items-center gap-2 text-[13px]">
          <Avatar name={name} src={avatarUrl} className="size-7" />
          <span className="font-medium">{name}</span>
          {mentionsMe ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">{t("mentionsYou")}</span> : null}
        </div>
        {message.attachments.length > 0 ? (
          <div className="flex max-w-[85%] flex-wrap gap-1.5">
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} />
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className="flex max-w-[85%] items-start gap-1">
            <div
              data-testid="colleague-bubble"
              style={personTint(message.author?.id)}
              className={cn(
                "whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border px-4 py-2.5 text-[15px] leading-relaxed",
                mentionsMe && "ring-2 ring-brand/50",
              )}
            >
              <ProtectedText text={message.content} spans={message.hideSpans} renderPlain={withMentions} />
            </div>
            <SaveToMemory message={message} memoryTargets={memoryTargets} conversationId={conversationId} className={hover} />
            <ConfrontButton onConfront={onConfront} className={hover} />
          </div>
        ) : null}
        <MaskedView kind="message" maskedContent={message.maskedContent} counts={message.hideCounts} />
      </div>
    );
  }
  return (
    <div className="group/user flex animate-message-in flex-col items-end gap-2" data-testid="my-message">
      {message.attachments.length > 0 ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} />
          ))}
        </div>
      ) : null}
      {message.content && editing && onEdit ? (
        // Edit and run again: this message and what follows are replaced by the new version.
        <form
          className="w-full max-w-[85%] space-y-2 rounded-2xl border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            setEditing(false);
            onEdit(draft.trim());
          }}
        >
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            aria-label={tChat("editPrompt")}
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">{tChat("editHint")}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {tChat("cancel")}
            </Button>
            <Button type="submit" size="sm">
              {tChat("editSend")}
            </Button>
          </div>
        </form>
      ) : message.content ? (
        <div className="flex max-w-[85%] items-start gap-1">
          <ConfrontButton onConfront={onConfront} className={hover} />
          <SaveToMemory message={message} memoryTargets={memoryTargets} conversationId={conversationId} className={hover} />
          <Tooltip content={copied ? tChat("copied") : tChat("copy")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tChat("copy")}
              className={hover}
              onClick={async () => {
                await navigator.clipboard.writeText(message.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </Tooltip>
          {onEdit ? (
            <Tooltip content={tChat("editPrompt")}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={tChat("editPrompt")}
                className={hover}
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
              >
                <PencilIcon />
              </Button>
            </Tooltip>
          ) : null}
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[var(--glass-selected)] px-4 py-2.5 text-[15px] leading-relaxed shadow-[inset_0_1px_0_0_var(--glass-highlight),0_0_0_1px_var(--glass-ring)]">
            <ProtectedText text={message.content} spans={message.hideSpans} renderPlain={withMentions} />
          </div>
        </div>
      ) : null}
      <MaskedView kind="message" maskedContent={message.maskedContent} counts={message.hideCounts} align="end" />
    </div>
  );
}

export function AttachmentChip({
  attachment,
  onRemove,
  removeLabel,
  pending,
  hideBadge,
  onOpen,
}: {
  attachment: { id?: string; filename: string; kind: AttachmentKind; truncated?: boolean };
  onRemove?: () => void;
  removeLabel?: string;
  pending?: boolean;
  /** Hide: "3 à vérifier" (red), "3 protégés" (green) or a neutral note. */
  hideBadge?: { tone: "visible" | "protected" | "muted"; label: string };
  /** Opens the file's Hide preview. */
  onOpen?: () => void;
}) {
  const t = useTranslations("chat");
  const Icon = attachment.kind === "image" ? ImageIcon : attachment.kind === "video" ? FilmIcon : FileTextIcon;
  const body = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="max-w-44 truncate">{attachment.filename}</span>
      {attachment.truncated ? <span className="text-warning">{t("partiallyRead")}</span> : null}
      {hideBadge ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            hideBadge.tone === "visible" ? "text-destructive" : hideBadge.tone === "protected" ? "text-success" : "font-normal text-muted-foreground",
          )}
        >
          {hideBadge.tone === "visible" ? <span className="size-1.5 rounded-full bg-destructive" /> : null}
          {hideBadge.tone === "protected" ? <ShieldCheckIcon className="size-3.5" /> : null}
          {hideBadge.label}
        </span>
      ) : null}
    </>
  );
  const className = cn(
    "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[13px]",
    pending && "animate-pulse text-muted-foreground",
  );
  return (
    <span className={className}>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 hover:underline">
          {body}
        </button>
      ) : attachment.id && !onRemove ? (
        <a href={`/api/attachments/${attachment.id}`} className="inline-flex items-center gap-1.5 hover:underline">
          {body}
        </a>
      ) : (
        body
      )}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={removeLabel} className="-mr-1 ml-0.5 rounded px-1 text-muted-foreground hover:text-foreground">
          {"×"}
        </button>
      ) : null}
    </span>
  );
}

function AssistantMessage({
  message,
  live,
  isLastAnswer,
  busy,
  models,
  onRegenerate,
  memoryTargets,
  conversationId,
  invitable,
  onInvite,
  onConfront,
  confrontProgress,
  onLearning,
  render,
  bubble = false,
  pdfAsked = false,
}: {
  message: TimelineMessage;
  render?: RenderProps | null;
  bubble?: boolean;
  pdfAsked?: boolean;
  live?: boolean;
  isLastAnswer: boolean;
  busy: boolean;
  models: PickerModel[];
  onRegenerate: (modelChoice?: string) => void;
} & MemoryProps &
  InviteProps &
  ConfrontProps &
  LearningProps) {
  const t = useTranslations("chat");
  const tCollab = useTranslations("collaboration");
  const [copied, setCopied] = React.useState(false);
  const [openSource, setOpenSource] = React.useState<number | null>(null);
  // Also while a colleague's request is being answered (real time shows the answer once written).
  const waiting = (live || message.status === "streaming") && !message.content;
  const brand = message.model ? modelDisplay(message.model.provider, message.model.label).brand : "";
  const errorKey: ProviderErrorCode = PROVIDER_ERROR_CODES.includes(message.errorCode as ProviderErrorCode)
    ? (message.errorCode as ProviderErrorCode)
    : "unknown";
  const confrontation = message.confrontation;
  const canRegenerate = !confrontation && isLastAnswer && !live && !busy && message.status !== "streaming";
  const mood = useAssistantMood(Boolean(live), waiting, message.status);

  return (
    <article className="group/answer animate-message-in space-y-2.5" aria-busy={live}>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
        {!confrontation ? (
          <AssistantAvatar provider={message.model?.provider ?? "auto"} size={30} state={mood} animated={mood !== "idle"} seed={message.id} />
        ) : null}
        {message.model && !confrontation ? <ModelName provider={message.model.provider} label={message.model.label} dot={false} /> : null}
        {!message.model && !confrontation && waiting ? <span className="font-medium text-foreground">{t("auto")}</span> : null}
        {message.routing ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <SparklesIcon className="size-3 text-brand" />
            {t("routingLine", { task: t(`task.${message.routing.task}`), basis: t(`basis.${message.routing.basis}`) })}
          </span>
        ) : null}
      </header>

      {confrontation ? (
        <ConfrontationView
          confrontation={confrontation}
          progress={confrontProgress}
          running={message.status === "streaming"}
          failed={message.status === "error"}
          onCite={message.sources.length ? setOpenSource : undefined}
        />
      ) : waiting ? (
        <p className="flex h-7 items-center gap-2 text-[14px]" role="status">
          <span className="text-shimmer font-medium">
            {message.searching ? t("searchingWeb") : brand ? t("thinkingNamed", { name: brand }) : t("thinking")}
          </span>
        </p>
      ) : message.content ? (
        bubble ? (
          <div data-testid="ai-bubble" className="glass-standard w-fit max-w-[92%] rounded-2xl rounded-tl-md border px-4 py-3">
            <Markdown onCite={message.sources.length ? setOpenSource : undefined}>{message.content}</Markdown>
          </div>
        ) : (
          <Markdown onCite={message.sources.length ? setOpenSource : undefined}>{message.content}</Markdown>
        )
      ) : null}
      {render && !live && message.status === "complete" && message.content ? (
        <RenderPanel key={message.id} messageId={message.id} kind={render.kind} content={message.content} attachments={render.attachments} />
      ) : null}

      {message.status === "error" && !confrontation ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive-soft/60 px-3 py-2.5 text-sm">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{t(`providerErrors.${errorKey}`, { model: brand })}</span>
        </div>
      ) : null}
      {message.status === "stopped" && !confrontation ? <p className="text-[13px] text-muted-foreground">{t("stopped")}</p> : null}
      {message.status === "streaming" && !live ? (
        <p className="text-[13px] text-muted-foreground">{t("inProgressElsewhere")}</p>
      ) : null}
      {!live ? <MaskedView kind="answer" maskedContent={message.maskedContent} counts={null} /> : null}
      <SourceList sources={message.sources} onOpen={setOpenSource} />
      {message.webSources.length > 0 ? <WebSourceList sources={message.webSources} /> : null}
      {!live && message.status === "complete" ? (
        <MemoryLine messageId={message.id} memory={message.memory} learning={message.learning} onLearning={(state) => onLearning?.(state)} />
      ) : null}
      {pdfAsked && message.status === "complete" && message.content.trim() && !live ? (
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a href={`/api/messages/${message.id}/export?format=pdf`} download>
            <DownloadIcon />
            {t("downloadPdf")}
          </a>
        </Button>
      ) : null}
      <SourceSheet source={message.sources.find((x) => x.position === openSource) ?? null} onClose={() => setOpenSource(null)} />
      {message.omittedMessages > 0 ? (
        <p className="text-xs text-muted-foreground">{t("omitted", { count: message.omittedMessages })}</p>
      ) : null}
      {message.contextLimited ? (
        <Tooltip content={tCollab("contextLimitedHint")}>
          <p className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground" tabIndex={0}>
            <UsersIcon className="size-3.5" />
            {tCollab("contextLimited")}
          </p>
        </Tooltip>
      ) : null}
      {invitable?.length && onInvite && !live ? (
        <div className="flex flex-wrap gap-1.5">
          {invitable.map((c) => (
            <Button key={c.userId} variant="outline" size="sm" className="gap-1.5" onClick={() => onInvite(c.userId)}>
              <UserPlusIcon />
              {tCollab("invite", { name: c.name })}
            </Button>
          ))}
        </div>
      ) : null}

      {!live && message.status !== "streaming" ? (
        <div className={cn("flex items-center gap-0.5 transition-opacity", !isLastAnswer && "opacity-0 group-hover/answer:opacity-100 focus-within:opacity-100")}>
          {message.content ? (
            <Tooltip content={copied ? t("copied") : t("copy")}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("copy")}
                onClick={async () => {
                  await navigator.clipboard.writeText(message.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </Tooltip>
          ) : null}
          {message.status === "complete" ? <SaveToMemory message={message} memoryTargets={memoryTargets} conversationId={conversationId} /> : null}
          {!confrontation && message.status === "complete" ? <ConfrontButton onConfront={onConfront} /> : null}
          {message.status === "complete" && message.content.trim() ? <ExportMenu messageId={message.id} table={hasTable(message.content)} /> : null}
          {canRegenerate ? (
            <>
              <Tooltip content={t("regenerate")}>
                <Button variant="ghost" size="icon-sm" aria-label={t("regenerate")} onClick={() => onRegenerate()}>
                  <RefreshCwIcon />
                </Button>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground">
                    {t("tryAnother")}
                    <ChevronDownIcon className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>{t("regenerateWith")}</DropdownMenuLabel>
                  {models
                    .filter((m) => m.available && m.id !== message.model?.id)
                    .map((m) => (
                      <DropdownMenuItem key={m.id} onSelect={() => onRegenerate(m.id)}>
                        <ProviderDot provider={m.provider} />
                        <span className="truncate">
                          <span className="font-medium">{modelDisplay(m.provider, m.label).brand}</span>{" "}
                          <span className="text-muted-foreground">{modelDisplay(m.provider, m.label).name}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Download an answer as Word or PDF, and its tables as CSV or Excel (built on our server). */
/** The web pages an answer relies on (the provider's own search), opened in a new tab. */
function WebSourceList({ sources }: { sources: TimelineMessage["webSources"] }) {
  const t = useTranslations("chat");
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  return (
    <div className="space-y-1.5" data-testid="web-sources">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <GlobeIcon className="size-3.5" />
        {t("webSources")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={s.title ?? s.url}
            className="inline-flex max-w-64 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-accent"
          >
            <span className="truncate font-medium">{s.title || host(s.url)}</span>
            <span className="shrink-0 text-muted-foreground">{host(s.url)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ExportMenu({ messageId, table }: { messageId: string; table: boolean }) {
  const t = useTranslations("chat");
  const formats = [
    ["docx", t("exportDocx")],
    ["pdf", t("exportPdf")],
    ...(table
      ? [
          ["xlsx", t("exportXlsx")],
          ["csv", t("exportCsv")],
        ]
      : []),
  ] as const;
  return (
    <DropdownMenu>
      <Tooltip content={t("export")}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("export")}>
            <DownloadIcon />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{t("export")}</DropdownMenuLabel>
        {formats.map(([format, label]) => (
          <DropdownMenuItem key={format} asChild>
            <a href={`/api/messages/${messageId}/export?format=${format}`} download>
              {label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The assistant's expression for one answer: thinking before the first words, speaking while they
 * stream, a short smile once done, then at rest. Only the answer being written here is animated.
 */
function useAssistantMood(live: boolean, waiting: boolean, status: TimelineMessage["status"]): AssistantState {
  const [justDone, setJustDone] = React.useState(false);
  const wasLive = React.useRef(live);
  React.useEffect(() => {
    if (wasLive.current && !live && status === "complete") {
      setJustDone(true);
      const timer = setTimeout(() => setJustDone(false), 1600);
      wasLive.current = live;
      return () => clearTimeout(timer);
    }
    wasLive.current = live;
  }, [live, status]);
  if (live) return waiting ? "thinking" : "speaking";
  return justDone ? "happy" : "idle";
}
