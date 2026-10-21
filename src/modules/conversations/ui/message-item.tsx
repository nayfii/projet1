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
  ImageIcon,
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
import { PROVIDER_ERROR_CODES, type ProviderErrorCode, type ProviderId } from "@/modules/providers/types";
import { cn } from "@/lib/utils";
import type { AttachmentKind, TimelineMessage } from "../types";
import type { RenderKind } from "@/modules/render/formats";
import { RenderPanel } from "@/modules/render/ui/render-panel";

type RenderProps = { kind: RenderKind; attachments: { id: string; filename: string; kind: AttachmentKind }[] };
import type { SuggestedColleague } from "../stream-events";
import { Markdown } from "./markdown";
import type { PickerModel } from "./model-picker";
import { ModelName, ProviderDot } from "./provider-mark";
import { SourceList, SourceSheet } from "@/modules/memory/ui/source-proof";
import { EntryDialog, type MemoryTarget } from "@/modules/memory/ui/entry-dialog";
import { MaskedView } from "@/modules/hide/ui/masked-view";
import { ProtectedText } from "@/modules/hide/ui/hide-composer";
import { ConfrontationView } from "@/modules/confronter/ui/confrontation-view";
import type { ConfrontationProgress } from "@/modules/confronter/types";
import { hasTable } from "@/modules/exports/blocks";

type MemoryProps = { memoryTargets: MemoryTarget[]; conversationId: string | null };

/** Who Can Help: colleagues the answer suggests who are not in the conversation yet. */
type InviteProps = { invitable?: SuggestedColleague[]; onInvite?: (userId: string) => void };

/** Confronter: opens the confirmation for this question (or the question this answer replies to). */
type ConfrontProps = { onConfront?: () => void; confrontProgress?: ConfrontationProgress };

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
  render,
}: {
  message: TimelineMessage;
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
  ConfrontProps) {
  if (message.role === "user") {
    const mine = !message.author || message.author.id === meId;
    return <UserMessage message={message} mine={mine} memoryTargets={memoryTargets} conversationId={conversationId} onConfront={onConfront} />;
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
      render={render}
    />
  );
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

function UserMessage({ message, mine, memoryTargets, conversationId, onConfront }: { message: TimelineMessage; mine: boolean } & MemoryProps & ConfrontProps) {
  const hover = "mt-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/user:opacity-100";
  const t = useTranslations("collaboration");
  if (!mine) {
    // A colleague's message (group conversation, or a conversation taken over after a transfer).
    const name = message.author?.name ?? t("someone");
    return (
      <div className="group/user flex flex-col items-start gap-2">
        <div className="flex items-center gap-2 text-[13px]">
          <Avatar name={name} className="size-5" />
          <span className="font-medium">{name}</span>
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
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-[15px] leading-relaxed">
              <ProtectedText text={message.content} spans={message.hideSpans} />
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
    <div className="group/user flex flex-col items-end gap-2">
      {message.attachments.length > 0 ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} />
          ))}
        </div>
      ) : null}
      {message.content ? (
        <div className="flex max-w-[85%] items-start gap-1">
          <ConfrontButton onConfront={onConfront} className={hover} />
          <SaveToMemory message={message} memoryTargets={memoryTargets} conversationId={conversationId} className={hover} />
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-relaxed">
            <ProtectedText text={message.content} spans={message.hideSpans} />
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
  render,
}: {
  message: TimelineMessage;
  render?: RenderProps | null;
  live?: boolean;
  isLastAnswer: boolean;
  busy: boolean;
  models: PickerModel[];
  onRegenerate: (modelChoice?: string) => void;
} & MemoryProps &
  InviteProps &
  ConfrontProps) {
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

  return (
    <article className="group/answer space-y-2" aria-busy={live}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        {message.model && !confrontation ? <ModelName provider={message.model.provider} label={message.model.label} /> : null}
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
        <div className="flex h-7 items-center gap-1" aria-label={t("thinking")}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      ) : message.content ? (
        <Markdown onCite={message.sources.length ? setOpenSource : undefined}>{message.content}</Markdown>
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

/** Thin divider shown when the conversation continues with another model. */
export function ModelSwitchDivider({ provider, label }: { provider: ProviderId; label: string }) {
  const t = useTranslations("chat");
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span className="inline-flex items-center gap-1.5">
        {t("continuedWith")} <ModelName provider={provider} label={label} />
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Download an answer as Word or PDF, and its tables as CSV or Excel (built on our server). */
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
