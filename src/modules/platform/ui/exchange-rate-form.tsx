"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { setExchangeRateAction } from "../server/actions";

/** The rate our team uses to compare AI costs (in dollars) with euro prices. */
export function ExchangeRateForm({ usdToEur }: { usdToEur: number | null }) {
  const t = useTranslations("platformUsage");
  const tErrors = useTranslations("errors");
  const [state, action] = useActionState(setExchangeRateAction, null);
  useEffect(() => {
    if (state?.ok) toast.success(t("rateSaved"));
  }, [state, t]);

  return (
    <form action={action} className="space-y-2">
      <label htmlFor="usd-to-eur" className="text-sm font-medium">
        {t("rateLabel")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("ratePrefix")}</span>
        <Input
          id="usd-to-eur"
          name="usdToEur"
          inputMode="decimal"
          pattern="[0-9]+([.,][0-9]{1,4})?"
          defaultValue={usdToEur ?? ""}
          className="w-28 tabular-nums"
          aria-describedby="usd-to-eur-hint"
        />
        <span className="text-sm text-muted-foreground">{t("rateSuffix")}</span>
        <SubmitButton size="sm" variant="outline">
          {t("rateSave")}
        </SubmitButton>
      </div>
      <p id="usd-to-eur-hint" className="text-[13px] text-muted-foreground">
        {t("rateHint")}
      </p>
      {state && !state.ok ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
    </form>
  );
}
