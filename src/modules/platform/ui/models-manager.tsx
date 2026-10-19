"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { PencilIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui/page-header";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelName } from "@/modules/conversations/ui/provider-mark";
import type { CatalogModel } from "@/modules/providers/catalog";
import { PROVIDER_BRANDS, PROVIDER_IDS } from "@/modules/providers/types";
import { savePlatformModelAction } from "@/modules/providers/server/actions";

export type PlatformModel = CatalogModel & { isEnabled: boolean; defaultAllowed: boolean };

const STRENGTHS = ["writing", "reasoning", "code", "long_context", "speed", "vision"] as const;

export function ModelsManager({ header, models, configured }: { header: { title: string; description: string }; models: PlatformModel[]; configured: string[] }) {
  const t = useTranslations("platformModels");
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [editing, setEditing] = useState<PlatformModel | "new" | null>(null);
  const price = (v: number) => format.number(v, { maximumFractionDigits: 4 });

  return (
    <div className="space-y-6">
      <PageHeader
        className="pb-2"
        title={header.title}
        description={header.description}
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("newModel")}
          </Button>
        }
      />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b text-left text-[13px] text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">{t("colModel")}</th>
              <th className="px-4 py-2.5 font-medium">{t("colApiId")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("colPrice")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("colCredits")}</th>
              <th className="px-4 py-2.5 font-medium">{t("colStatus")}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {models.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3">
                  <ModelName provider={m.provider} label={m.label} />
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{tChat(`tier.${m.tier}`)}</p>
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">{m.apiModelId}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[13px]">
                  {t("perMillion", { input: price(m.pricing.inputUsdPerMtok), output: price(m.pricing.outputUsdPerMtok) })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[13px]">
                  {t("perMillion", { input: price(m.pricing.inputCreditsPerMtok), output: price(m.pricing.outputCreditsPerMtok) })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {m.isEnabled ? <Badge variant="success">{t("enabled")}</Badge> : <Badge variant="outline">{t("disabled")}</Badge>}
                    {!configured.includes(m.provider) ? <Badge variant="warning">{t("noKey")}</Badge> : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEditing(m)}>
                    <PencilIcon />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="space-y-1 text-[13px] text-muted-foreground">
        <p>{t("pricingNote")}</p>
        <p>{t("creditsNote")}</p>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("newModel") : t("edit")}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <ModelForm key={editing === "new" ? "new" : editing.id} model={editing === "new" ? null : editing} onSaved={() => setEditing(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelForm({ model, onSaved }: { model: PlatformModel | null; onSaved: () => void }) {
  const t = useTranslations("platformModels");
  const tChat = useTranslations("chat");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [state, action] = useActionState(savePlatformModelAction, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(t("saved"));
      onSaved();
    }
  }, [state, onSaved, t]);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="isNew" value={model ? "false" : "true"} />
      {model ? <input type="hidden" name="id" value={model.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {!model ? (
          <Field label={t("id")} htmlFor="m-id" hint={t("idHint")}>
            <Input id="m-id" name="id" required pattern="[a-z0-9][a-z0-9._\-]{1,62}" />
          </Field>
        ) : null}
        <Field label={t("provider")} htmlFor="m-provider">
          <Select name="provider" defaultValue={model?.provider ?? "openai"} disabled={Boolean(model)}>
            <SelectTrigger id="m-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_IDS.map((p) => (
                <SelectItem key={p} value={p}>
                  {PROVIDER_BRANDS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {model ? <input type="hidden" name="provider" value={model.provider} /> : null}
        </Field>
        <Field label={t("label")} htmlFor="m-label">
          <Input id="m-label" name="label" required maxLength={80} defaultValue={model?.label} />
        </Field>
        <Field label={t("apiModelId")} htmlFor="m-api" hint={t("apiModelIdHint")}>
          <Input id="m-api" name="apiModelId" required maxLength={120} defaultValue={model?.apiModelId} className="font-mono text-[13px]" />
        </Field>
        <Field label={t("tier")} htmlFor="m-tier">
          <Select name="tier" defaultValue={model?.tier ?? "balanced"}>
            <SelectTrigger id="m-tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["fast", "balanced", "advanced"] as const).map((tier) => (
                <SelectItem key={tier} value={tier}>
                  {tChat(`tier.${tier}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("contextWindow")} htmlFor="m-ctx">
          <Input id="m-ctx" name="contextWindow" type="number" min={8000} required defaultValue={model?.contextWindow ?? 200000} />
        </Field>
        <Field label={t("maxOutput")} htmlFor="m-out">
          <Input id="m-out" name="maxOutputTokens" type="number" min={256} required defaultValue={model?.maxOutputTokens ?? 16000} />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("strengths")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {STRENGTHS.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <Checkbox name="strengths" value={s} defaultChecked={model?.strengths.includes(s)} />
              {t(`strength.${s}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("priceTitle")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("input")} htmlFor="m-in-usd">
            <Input id="m-in-usd" name="inputUsd" type="number" step="any" min={0} required defaultValue={model?.pricing.inputUsdPerMtok ?? 0} />
          </Field>
          <Field label={t("output")} htmlFor="m-out-usd">
            <Input id="m-out-usd" name="outputUsd" type="number" step="any" min={0} required defaultValue={model?.pricing.outputUsdPerMtok ?? 0} />
          </Field>
          <Field label={t("cached")} htmlFor="m-cache-usd">
            <Input id="m-cache-usd" name="cachedUsd" type="number" step="any" min={0} required defaultValue={model?.pricing.cachedInputUsdPerMtok ?? 0} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("creditsTitle")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("input")} htmlFor="m-in-cr">
            <Input id="m-in-cr" name="inputCredits" type="number" step="any" min={0} required defaultValue={model?.pricing.inputCreditsPerMtok ?? 0} />
          </Field>
          <Field label={t("output")} htmlFor="m-out-cr">
            <Input id="m-out-cr" name="outputCredits" type="number" step="any" min={0} required defaultValue={model?.pricing.outputCreditsPerMtok ?? 0} />
          </Field>
          <Field label={t("cached")} htmlFor="m-cache-cr">
            <Input id="m-cache-cr" name="cachedCredits" type="number" step="any" min={0} required defaultValue={model?.pricing.cachedInputCreditsPerMtok ?? 0} />
          </Field>
        </div>
      </fieldset>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
          <span>{t("supportsImages")}</span>
          <Switch name="supportsImages" defaultChecked={model?.supportsImages ?? true} />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
          <span>{t("enabledLabel")}</span>
          <Switch name="isEnabled" defaultChecked={model?.isEnabled ?? true} />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
          <span>{t("defaultAllowedLabel")}</span>
          <Switch name="defaultAllowed" defaultChecked={model?.defaultAllowed ?? true} />
        </label>
      </div>
      {state && !state.ok ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
      <div className="flex justify-end">
        <SubmitButton>{tCommon("save")}</SubmitButton>
      </div>
    </form>
  );
}
