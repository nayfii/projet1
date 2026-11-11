"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { setDictationRateAction } from "../server/admin-actions";

/** Platform admin: what one minute of voice dictation costs in credits, and its estimated provider cost. */
export function DictationRateForm({ credits, costUsd, model }: { credits: number; costUsd: number; model: string }) {
  const t = useTranslations("platformModels");
  const tErrors = useTranslations("errors");
  const [saving, startSaving] = React.useTransition();
  return (
    <section className="space-y-3 glass-standard rounded-xl border p-5" aria-labelledby="dictation-rate">
      <div>
        <h2 id="dictation-rate" className="text-[15px] font-medium">
          {t("dictationRateTitle")}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("dictationRateHint", { model })}</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          startSaving(async () => {
            const result = await setDictationRateAction({ credits: Number(form.get("credits")), costUsd: Number(form.get("costUsd")) });
            if (result.ok) toast.success(t("dictationRateSaved"));
            else toast.error(tErrors(result.error));
          });
        }}
      >
        <Field label={t("dictationRateCredits")} htmlFor="dictation-credits">
          <Input id="dictation-credits" name="credits" type="number" min={0} step="0.01" defaultValue={credits} required className="w-40" />
        </Field>
        <Field label={t("dictationRateCost")} htmlFor="dictation-cost">
          <Input id="dictation-cost" name="costUsd" type="number" min={0} step="0.0001" defaultValue={costUsd} required className="w-40" />
        </Field>
        <Button type="submit" variant="outline" disabled={saving}>
          {saving ? <Spinner /> : null}
          {t("dictationRateSave")}
        </Button>
      </form>
    </section>
  );
}
