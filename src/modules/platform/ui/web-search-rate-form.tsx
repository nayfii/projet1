"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { setWebSearchRateAction } from "../server/app-actions";

/** Platform admin: what one web search costs in credits, and its estimated provider cost. */
export function WebSearchRateForm({ credits, costUsd }: { credits: number; costUsd: number }) {
  const t = useTranslations("platformModels");
  const tErrors = useTranslations("errors");
  const [saving, startSaving] = React.useTransition();
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5" aria-labelledby="web-search-rate">
      <div>
        <h2 id="web-search-rate" className="text-[15px] font-medium">
          {t("webSearchRateTitle")}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("webSearchRateHint")}</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          startSaving(async () => {
            const result = await setWebSearchRateAction({ credits: Number(form.get("credits")), costUsd: Number(form.get("costUsd")) });
            if (result.ok) toast.success(t("webSearchRateSaved"));
            else toast.error(tErrors(result.error));
          });
        }}
      >
        <Field label={t("webSearchRateCredits")} htmlFor="web-search-credits">
          <Input id="web-search-credits" name="credits" type="number" min={0} step="0.01" defaultValue={credits} required className="w-40" />
        </Field>
        <Field label={t("webSearchRateCost")} htmlFor="web-search-cost">
          <Input id="web-search-cost" name="costUsd" type="number" min={0} step="0.0001" defaultValue={costUsd} required className="w-40" />
        </Field>
        <Button type="submit" variant="outline" disabled={saving}>
          {saving ? <Spinner /> : null}
          {t("webSearchRateSave")}
        </Button>
      </form>
    </section>
  );
}
