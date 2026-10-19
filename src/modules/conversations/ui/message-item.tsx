"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircleIcon,
  BookmarkPlusIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
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
import type { TimelineMessage } from "../types";
import { Markdown } from "./markdown";
import type { PickerModel } from "./model-picker";
import { ModelName, ProviderDot } from "./provider-mark";
import { SourceList, SourceSheet } from "@/modules/memory/ui/source-proof";
import { EntryDialog, type MemoryTarget } from "@/modules/memory/ui/entry-dialog";
import { MaskedView } from "@/modules/hide/ui/masked-view";

type MemoryProps = { memoryTargets: MemoryTarget[]; conversationId: string | null };

export function MessageItem({
  message,
  live,
  isLastAnswer,
  busy,
  models,
  onRegenerate,
  memoryTargets,
  conversationId,
}: {
  message: TimelineMessage;
  /** The answer is streaming right now in this browser. */
  live?: boolean;
  isLastAnswer: boolean;
  busy: boolean;
  models: PickerModel[];
  onRegenerate: (modelChoice?: string) => void;
} & MemoryProps) {
  if (message.role === "user") return <UserMessage message={message} memoryTargets={memoryTargets} conversationId={conversationId} />;
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
    />
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

function UserMessage({ message, memoryTargets, conversationId }: { message: TimelineMessage } & MemoryProps) {
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
          <SaveToMemory
            message={message}
            memoryTargets={memoryTargets}
            conversationId={conversationId}
            className="mt-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/user:opacity-100"
          />
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-relaxed">
            {message.content}
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
}: {
  attachment: { id?: string; filename: string; kind: "image" | "document"; truncated?: boolean };
  onRemove?: () => void;
  removeLabel?: string;
  pending?: boolean;
}) {
  const t = useTranslations("chat");
  const Icon = attachment.kind === "image" ? ImageIcon : FileTextIcon;
  const body = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="max-w-44 truncate">{attachment.filename}</span>
      {attachment.truncated ? <span className="text-warning">{t("partiallyRead")}</span> : null}
    </>
  );
  const className = cn(
    "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[13px]",
    pending && "animate-pulse text-muted-foreground",
  );
  return (
    <span className={className}>
      {attachment.id && !onRemove ? (
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
}: {
  message: TimelineMessage;
  live?: boolean;
  isLastAnswer: boolean;
  busy: boolean;
  models: PickerModel[];
  onRegenerate: (modelChoice?: string) => void;
} & MemoryProps) {
  const t = useTranslations("chat");
  const [copied, setCopied] = React.useState(false);
  const [openSource, setOpenSource] = React.useState<number | null>(null);
  const waiting = live && !message.content;
  const brand = message.model ? modelDisplay(message.model.provider, message.model.label).brand : "";
  const errorKey: ProviderErrorCode = PROVIDER_ERROR_CODES.includes(message.errorCode as ProviderErrorCode)
    ? (message.errorCode as ProviderErrorCode)
    : "unknown";
  const canRegenerate = isLastAnswer && !live && !busy && message.status !== "streaming";

  return (
    <article className="group/answer space-y-2" aria-busy={live}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        {message.model ? <ModelName provider={message.model.provider} label={message.model.label} /> : null}
        {message.routing ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <SparklesIcon className="size-3 text-brand" />
            {t("routingLine", { task: t(`task.${message.routing.task}`), basis: t(`basis.${message.routing.basis}`) })}
          </span>
        ) : null}
      </header>

      {waiting ? (
        <div className="flex h-7 items-center gap-1" aria-label={t("thinking")}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      ) : message.content ? (
        <Markdown onCite={message.sources.length ? setOpenSource : undefined}>{message.content}</Markdown>
      ) : null}

      {message.status === "error" ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive-soft/60 px-3 py-2.5 text-sm">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{t(`providerErrors.${errorKey}`, { model: brand })}</span>
        </div>
      ) : null}
      {message.status === "stopped" ? <p className="text-[13px] text-muted-foreground">{t("stopped")}</p> : null}
      {message.status === "streaming" && !live ? (
        <p className="text-[13px] text-muted-foreground">{t("inProgressElsewhere")}</p>
      ) : null}
      {!live ? <MaskedView kind="answer" maskedContent={message.maskedContent} counts={null} /> : null}
      <SourceList sources={message.sources} onOpen={setOpenSource} />
      <SourceSheet source={message.sources.find((x) => x.position === openSource) ?? null} onClose={() => setOpenSource(null)} />
      {message.omittedMessages > 0 ? (
        <p className="text-xs text-muted-foreground">{t("omitted", { count: message.omittedMessages })}</p>
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
