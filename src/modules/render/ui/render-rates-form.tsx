"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { setRenderRatesAction } from "../server/admin-actions";

/** Platform admin: video credits per second of video, for Motion Design and the Video Editor. */
export function RenderRatesForm({ motion, videoEdit }: { motion: number; videoEdit: number }) {
  const t = useTranslations("platformModels");
  const tErrors = useTranslations("errors");
  const [saving, startSaving] = React.useTransition();
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5" aria-labelledby="render-rates">
      <div>
        <h2 id="render-rates" className="text-[15px] font-medium">
          {t("renderRatesTitle")}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("renderRatesHint")}</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          startSaving(async () => {
            const result = await setRenderRatesAction({ motion: Number(form.get("motion")), videoEdit: Number(form.get("videoEdit")) });
            if (result.ok) toast.success(t("renderRatesSaved"));
            else toast.error(tErrors(result.error));
          });
        }}
      >
        <Field label={t("renderRateMotion")} htmlFor="rate-motion">
          <Input id="rate-motion" name="motion" type="number" min={0} step="0.01" defaultValue={motion} required className="w-40" />
        </Field>
        <Field label={t("renderRateVideoEdit")} htmlFor="rate-video-edit">
          <Input id="rate-video-edit" name="videoEdit" type="number" min={0} step="0.01" defaultValue={videoEdit} required className="w-40" />
        </Field>
        <Button type="submit" variant="outline" disabled={saving}>
          {saving ? <Spinner /> : null}
          {t("renderRatesSave")}
        </Button>
      </form>
    </section>
  );
}
