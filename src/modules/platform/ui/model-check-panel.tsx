"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2Icon, ListChecksIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/form";
import { PROVIDER_BRANDS, PROVIDER_ERROR_CODES } from "@/modules/providers/types";
import { checkAllModelsAction } from "../server/actions";
import type { ModelCheck } from "../server/model-check";

/**
 * "Test each model": once the AI keys are in place, every model the product uses is tried for real,
 * one line each, with the reason in plain words when one does not answer.
 */
export function ModelCheckPanel() {
  const t = useTranslations("platformHealth");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ testMode: boolean; checks: ModelCheck[] } | null>(null);
  const reason = (code: string | null) => t(`codes.${(PROVIDER_ERROR_CODES as readonly string[]).includes(code ?? "") ? code! : "unknown"}` as "codes.unknown");
  const working = result?.checks.filter((c) => c.ok).length ?? 0;

  return (
    <Card className="mt-6 p-5" aria-labelledby="model-check">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="model-check" className="flex items-center gap-2 font-medium">
            <ListChecksIcon className="size-4 text-muted-foreground" />
            {t("checkAllTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{t("checkAllBody")}</p>
        </div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const response = await checkAllModelsAction();
              if (!response.ok) return void toast.error(tErrors(response.error));
              setResult(response.data ?? null);
              router.refresh();
            })
          }
        >
          {pending ? <Spinner /> : <ListChecksIcon />}
          {pending ? t("checkAllRunning") : t("checkAll")}
        </Button>
      </div>

      {result?.testMode ? <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-[13px]">{t("checkAllTestMode")}</p> : null}
      {result && !result.testMode ? (
        <>
          <p className="mt-4 text-sm" role="status">
            {t("checkAllSummary", { ok: working, total: result.checks.length })}
          </p>
          <ul className="mt-3 divide-y rounded-xl border">
            {result.checks.map((c) => (
              <li key={`${c.kind}-${c.provider}-${c.apiModelId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                {c.ok ? <CheckCircle2Icon className="size-4 text-success" aria-hidden /> : <XCircleIcon className="size-4 text-destructive" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{c.kind === "chat" ? c.label : t(`checkKind.${c.kind}`)}</span>
                  <span className="text-muted-foreground"> · {PROVIDER_BRANDS[c.provider]} · </span>
                  <code className="text-[12px] text-muted-foreground">{c.apiModelId}</code>
                </span>
                <span className={c.ok ? "text-[13px] text-muted-foreground" : "text-[13px] text-destructive"}>
                  {c.ok ? t("checkOk", { ms: c.latencyMs }) : reason(c.code)}
                </span>
              </li>
            ))}
          </ul>
          {result.checks.some((c) => !c.ok) ? <p className="mt-3 text-[13px] text-muted-foreground">{t("checkAllHelp")}</p> : null}
        </>
      ) : null}
    </Card>
  );
}
