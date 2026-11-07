"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronRightIcon, CodeIcon, FileTextIcon, PresentationIcon, TableIcon } from "lucide-react";
import { Spinner } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { readArtifact, type ArtifactKind, type ArtifactVersion } from "../parse";

/** The conversation's artifacts and the workspace on the right (provided by the chat). */
export type ArtifactsApi = {
  versions: Map<string, ArtifactVersion[]>;
  /** The artifact shown in the workspace, if any. */
  openKey: string | null;
  open: (key: string, version?: number) => void;
};
export const ArtifactsContext = React.createContext<ArtifactsApi | null>(null);
/** Which message a card belongs to, and whether that message is still being written. */
export const ArtifactMessageContext = React.createContext<{ messageId: string; live: boolean } | null>(null);

export const ARTIFACT_ICONS: Record<ArtifactKind, React.ComponentType<{ className?: string }>> = {
  document: FileTextIcon,
  sheet: TableIcon,
  slides: PresentationIcon,
  code: CodeIcon,
};

/**
 * An artifact in the conversation: a compact card (kind, title, version) that opens it in the
 * workspace on the right. While the answer is still being written, the card says so. Outside a
 * conversation (no workspace), the content is shown folded under the card.
 */
export function ArtifactCard({ kind, raw }: { kind: ArtifactKind; raw: string }) {
  const t = useTranslations("artifacts");
  const api = React.useContext(ArtifactsContext);
  const message = React.useContext(ArtifactMessageContext);
  const artifact = React.useMemo(() => readArtifact(kind, raw), [kind, raw]);
  const Icon = ARTIFACT_ICONS[kind];
  const versions = api?.versions.get(artifact.key) ?? [];
  const mine = versions.find((v) => v.messageId === message?.messageId && v.body === artifact.body);
  const writing = message?.live === true && !mine;
  const isOpen = api?.openKey === artifact.key;

  const label = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground/80">
        {writing ? <Spinner className="size-4" /> : <Icon className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{artifact.title || t(`kind.${kind}`)}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {writing ? t("writing") : t("meta", { kind: t(`kind.${kind}`), version: mine?.version ?? 1, edited: mine?.role === "user" ? "yes" : "no" })}
        </span>
      </span>
    </>
  );

  if (!api) {
    return (
      <details className="not-prose my-3 rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">{label}</summary>
        <pre className="max-h-96 overflow-auto border-t px-4 py-3 font-mono text-[12.5px] leading-5 whitespace-pre-wrap">{artifact.body}</pre>
      </details>
    );
  }

  return (
    <button
      type="button"
      disabled={writing}
      data-testid="artifact-card"
      onClick={() => api.open(artifact.key, mine?.version)}
      className={cn(
        "not-prose my-3 flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors",
        writing ? "cursor-default" : "hover:bg-accent/60",
        isOpen && "border-foreground/25",
      )}
    >
      {label}
      {writing ? null : (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
          {isOpen ? t("opened") : t("open")}
          <ChevronRightIcon className="size-3.5" />
        </span>
      )}
    </button>
  );
}
