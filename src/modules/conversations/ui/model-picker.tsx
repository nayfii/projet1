"use client";

import { useTranslations } from "next-intl";
import { ChevronDownIcon, SparklesIcon, CheckIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { modelDisplay, MODEL_CHOICE_AUTO, type ModelTier } from "@/modules/providers/catalog";
import { PROVIDER_IDS, type ProviderId } from "@/modules/providers/types";
import { cn } from "@/lib/utils";
import { ProviderDot } from "./provider-mark";

export type PickerModel = {
  id: string;
  provider: ProviderId;
  label: string;
  tier: ModelTier;
  /** False when the provider's key is missing on the server. */
  available: boolean;
};

export function ModelPicker({
  value,
  onChange,
  models,
  autoEnabled,
  disabled,
  align = "start",
}: {
  value: string;
  onChange: (choice: string) => void;
  models: PickerModel[];
  autoEnabled: boolean;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const t = useTranslations("chat");
  const current = models.find((m) => m.id === value);
  const isAuto = value === MODEL_CHOICE_AUTO;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={t("modelPicker")}
        className="flex h-8 max-w-56 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        {isAuto || !current ? (
          <>
            <SparklesIcon className="size-3.5 text-brand" />
            <span className="font-medium text-foreground">{t("auto")}</span>
          </>
        ) : (
          <>
            <ProviderDot provider={current.provider} />
            <span className="truncate">
              <span className="font-medium text-foreground">{modelDisplay(current.provider, current.label).brand}</span>{" "}
              {modelDisplay(current.provider, current.label).name}
            </span>
          </>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side="top" className="w-72">
        {autoEnabled ? (
          <>
            <DropdownMenuItem onSelect={() => onChange(MODEL_CHOICE_AUTO)} className="items-start py-2">
              <SparklesIcon className="mt-0.5 !text-brand" />
              <span className="flex-1">
                <span className="block font-medium">{t("auto")}</span>
                <span className="block text-xs text-muted-foreground">{t("autoHint")}</span>
              </span>
              {isAuto ? <CheckIcon className="mt-0.5" /> : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {PROVIDER_IDS.map((provider) => {
          const group = models.filter((m) => m.provider === provider);
          if (group.length === 0) return null;
          return (
            <div key={provider}>
              <DropdownMenuLabel>{modelDisplay(provider, "").brand}</DropdownMenuLabel>
              {group.map((m) => (
                <DropdownMenuItem key={m.id} disabled={!m.available} onSelect={() => onChange(m.id)}>
                  <ProviderDot provider={m.provider} />
                  <span className="flex-1 truncate">{modelDisplay(m.provider, m.label).name}</span>
                  {m.available ? (
                    <span className={cn("text-xs text-muted-foreground", value === m.id && "hidden")}>{t(`tier.${m.tier}`)}</span>
                  ) : (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      {t("notConfigured")}
                    </Badge>
                  )}
                  {value === m.id ? <CheckIcon /> : null}
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
