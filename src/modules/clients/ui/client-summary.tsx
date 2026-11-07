"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { RefreshCwIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/modules/conversations/ui/markdown";
import { clientSummaryAction } from "../server/actions";
import type { ClientSummary } from "../server/summary";

/** "En bref": the client in a few lines, made by the AI from what this person may open. */
export function ClientSummaryCard({ clientId }: { clientId: string }) {
  const t = useTranslations("clients");
  const format = useFormatter();
  const [state, setState] = React.useState<ClientSummary | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setState(await clientSummaryAction({ clientId, refresh }));
      setLoading(false);
    },
    [clientId],
  );
  React.useEffect(() => {
    let cancelled = false;
    void clientSummaryAction({ clientId }).then((result) => {
      if (cancelled) return;
      setState(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <section
      aria-labelledby="client-summary"
      className="relative overflow-hidden rounded-2xl border bg-card p-6"
      // A faint wash in the expressive themes only (--decor-strength is 0% in Light and Dark).
      style={{
        backgroundImage:
          "linear-gradient(135deg, color-mix(in oklch, var(--pastel-lavender) calc(var(--decor-strength) * 0.56), var(--card)), var(--card) 55%, color-mix(in oklch, var(--pastel-sky) calc(var(--decor-strength) * 0.44), var(--card)))",
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="client-summary" className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <SparklesIcon className="size-3.5 text-brand" />
          {t("summaryTitle")}
        </h2>
        {state && "text" in state ? (
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => void load(true)} disabled={loading}>
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
            {t("summaryRefresh")}
          </Button>
        ) : null}
      </div>
      {loading && !state ? (
        <div className="space-y-2.5" aria-busy>
          <p className="text-shimmer text-[15px]">{t("summaryLoading")}</p>
          <div className="h-3 w-11/12 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded-full bg-muted" />
        </div>
      ) : state && "text" in state ? (
        <div className={loading ? "opacity-60 transition-opacity" : "animate-message-in"}>
          <div className="text-[15px] leading-relaxed">
            <Markdown>{state.text}</Markdown>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {t("summaryFootnote", { date: format.relativeTime(new Date(state.createdAt)) })}
          </p>
        </div>
      ) : (
        <p className="text-[14px] text-muted-foreground">{t(`summaryError.${state && "error" in state ? state.error : "unavailable"}`)}</p>
      )}
    </section>
  );
}
