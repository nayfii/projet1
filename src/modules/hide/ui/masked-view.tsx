"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ShieldCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { totalCount, type HideCategory, type HideCounts } from "../categories";

/**
 * Under a message: what Hide masked, and on request exactly what the AI received (user message)
 * or wrote (answer, before the real values were put back).
 */
export function MaskedView({
  kind,
  maskedContent,
  counts,
  align = "start",
}: {
  kind: "message" | "answer";
  maskedContent: string | null;
  counts: HideCounts | null;
  align?: "start" | "end";
}) {
  const t = useTranslations("hide");
  const [open, setOpen] = React.useState(false);
  const total = totalCount(counts);
  if (!maskedContent && total === 0) return null;
  const categories = (Object.keys(counts ?? {}) as HideCategory[]).map((c) => t(`category.${c}`)).join(", ");

  return (
    <div className={cn("flex max-w-[85%] flex-col gap-1.5", align === "end" ? "items-end self-end" : "items-start")}>
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-3.5 text-brand" />
        {kind === "message" ? <span title={categories}>{t("maskedCount", { count: total })}</span> : <span>{t("answerRestored")}</span>}
        {maskedContent ? (
          <>
            <span aria-hidden>{"·"}</span>
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="font-medium text-foreground/80 underline-offset-2 hover:underline">
              {open ? t("hideReceived") : kind === "message" ? t("showReceived") : t("showWritten")}
            </button>
          </>
        ) : total > 0 ? (
          <span>{t("filesOnly")}</span>
        ) : null}
      </p>
      {open && maskedContent ? (
        <div className="w-full rounded-lg border border-dashed bg-muted/40 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{kind === "message" ? t("receivedTitle") : t("writtenTitle")}</p>
          <p className="font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">{maskedContent}</p>
        </div>
      ) : null}
    </div>
  );
}
