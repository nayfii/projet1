"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProviderDot } from "@/modules/conversations/ui/provider-mark";
import { modelDisplay, MODEL_CHOICE_AUTO, type ModelTier } from "../catalog";
import { PROVIDER_IDS, type ProviderId } from "../types";
import { saveModelSettingsAction } from "../server/actions";

type Model = { id: string; provider: ProviderId; label: string; tier: ModelTier; configured: boolean };

export function ModelSettings({
  models,
  initial,
}: {
  models: Model[];
  initial: { allowed: string[]; defaultModelId: string | null; autoEnabled: boolean };
}) {
  const t = useTranslations("modelSettings");
  const tChat = useTranslations("chat");
  const tErrors = useTranslations("errors");
  const [allowed, setAllowed] = React.useState(new Set(initial.allowed));
  const [autoEnabled, setAutoEnabled] = React.useState(initial.autoEnabled);
  const [defaultChoice, setDefaultChoice] = React.useState(initial.defaultModelId ?? MODEL_CHOICE_AUTO);
  const [saving, startSaving] = React.useTransition();

  const defaultValid = defaultChoice === MODEL_CHOICE_AUTO ? autoEnabled : allowed.has(defaultChoice);
  const dirty =
    autoEnabled !== initial.autoEnabled ||
    defaultChoice !== (initial.defaultModelId ?? MODEL_CHOICE_AUTO) ||
    allowed.size !== initial.allowed.length ||
    initial.allowed.some((id) => !allowed.has(id));

  const toggle = (id: string, on: boolean) =>
    setAllowed((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = () =>
    startSaving(async () => {
      const result = await saveModelSettingsAction({
        allowed: [...allowed],
        defaultModelId: defaultChoice === MODEL_CHOICE_AUTO ? null : defaultChoice,
        autoEnabled,
      });
      if (result.ok) toast.success(t("saved"));
      else toast.error(tErrors(result.error));
    });

  return (
    <div className="space-y-8">
      <Card className="divide-y">
        <label className="flex items-start justify-between gap-4 p-4">
          <span className="flex items-start gap-3">
            <SparklesIcon className="mt-0.5 size-4 text-brand" />
            <span>
              <span className="block text-sm font-medium">{t("autoTitle")}</span>
              <span className="block text-[13px] text-muted-foreground">{t("autoBody")}</span>
            </span>
          </span>
          <Switch checked={autoEnabled} onCheckedChange={setAutoEnabled} aria-label={t("autoTitle")} />
        </label>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="block text-sm font-medium">{t("defaultTitle")}</span>
            <span className="block text-[13px] text-muted-foreground">{t("defaultBody")}</span>
          </span>
          <Select value={defaultChoice} onValueChange={setDefaultChoice}>
            <SelectTrigger className="w-64" aria-label={t("defaultTitle")} aria-invalid={!defaultValid}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {autoEnabled ? <SelectItem value={MODEL_CHOICE_AUTO}>{tChat("auto")}</SelectItem> : null}
              {models
                .filter((m) => allowed.has(m.id))
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {modelDisplay(m.provider, m.label).brand} {modelDisplay(m.provider, m.label).name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">{t("allowedTitle")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("allowedBody")}</p>
        </div>
        <Card className="divide-y">
          {PROVIDER_IDS.map((provider) => {
            const group = models.filter((m) => m.provider === provider);
            if (group.length === 0) return null;
            return (
              <div key={provider} className="p-4">
                <p className="mb-2 flex items-center gap-2 text-[13px] font-medium">
                  <ProviderDot provider={provider} />
                  {modelDisplay(provider, "").brand}
                  {!group[0].configured ? (
                    <Badge variant="warning" className="font-normal">
                      {t("notConfigured")}
                    </Badge>
                  ) : null}
                </p>
                <div className="space-y-1">
                  {group.map((m) => (
                    <label key={m.id} className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 hover:bg-accent/50">
                      <span className="text-sm">
                        {modelDisplay(m.provider, m.label).name}
                        <span className="ml-2 text-[13px] text-muted-foreground">{tChat(`tier.${m.tier}`)}</span>
                      </span>
                      <Switch
                        checked={allowed.has(m.id)}
                        onCheckedChange={(on) => toggle(m.id, on)}
                        aria-label={`${modelDisplay(m.provider, m.label).brand} ${modelDisplay(m.provider, m.label).name}`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
        <p className="text-[13px] text-muted-foreground">{t("notConfiguredHint")}</p>
      </section>

      <div className="flex items-center justify-end gap-3">
        {!defaultValid ? <p className="text-[13px] text-destructive">{t("defaultInvalid")}</p> : null}
        {allowed.size === 0 ? <p className="text-[13px] text-destructive">{t("noneAllowed")}</p> : null}
        <Button onClick={save} disabled={saving || !dirty || !defaultValid || allowed.size === 0}>
          {saving ? <Spinner /> : null}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
