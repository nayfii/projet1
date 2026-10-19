"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";

/** Extracted text of a document; the cited passage is highlighted and scrolled into view. */
export function DocumentText({ text, highlight }: { text: string; highlight: { start: number; end: number } | null }) {
  const t = useTranslations("memory");
  const mark = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    mark.current?.scrollIntoView({ block: "center" });
  }, []);
  if (!text) return <p className="text-sm text-muted-foreground">{t("noText")}</p>;
  const range = highlight && highlight.start < text.length ? { start: highlight.start, end: Math.min(highlight.end, text.length) } : null;
  return (
    <Card className="p-6">
      <div className="whitespace-pre-wrap text-sm leading-7">
        {range ? (
          <>
            {text.slice(0, range.start)}
            <mark ref={mark} className="rounded bg-brand-soft px-0.5 text-foreground ring-1 ring-brand/30" aria-label={t("citedPassage")}>
              {text.slice(range.start, range.end)}
            </mark>
            {text.slice(range.end)}
          </>
        ) : (
          text
        )}
      </div>
    </Card>
  );
}
