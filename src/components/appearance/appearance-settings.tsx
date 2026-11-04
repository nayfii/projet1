"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, SunMoonIcon } from "lucide-react";
import { SegmentedControl } from "glisse";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { AmbientPreview } from "@/components/shell/ambient-background";
import { AMBIENTS, isTheme, type Ambient } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { useAppearance } from "./appearance-provider";

/**
 * Settings → Appearance: the interface (light, dark, or following the device) and the ambient
 * background behind the glass, chosen independently; and whether the background moves. Each change
 * shows at once and is kept on this device.
 */
export function AppearanceSettings() {
  const t = useTranslations("appearance");
  const { theme, ambient, motion, setTheme, setAmbient, setMotion } = useAppearance();

  return (
    <Card id="appearance" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SunMoonIcon className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2.5">
          <h4 className="text-[13px] font-medium" id="appearance-interface">
            {t("interface")}
          </h4>
          <SegmentedControl
            aria-labelledby="appearance-interface"
            className="appearance-segmented"
            items={[
              { value: "light", label: t("themeLight") },
              { value: "dark", label: t("themeDark") },
              { value: "system", label: t("themeSystem") },
            ]}
            value={theme}
            onValueChange={(value) => {
              if (isTheme(value)) setTheme(value);
            }}
          />
          <p className="text-xs text-muted-foreground">{t("interfaceHint")}</p>
        </section>

        <section className="space-y-2.5">
          <h4 className="text-[13px] font-medium" id="appearance-background">
            {t("background")}
          </h4>
          <div role="radiogroup" aria-labelledby="appearance-background" className="grid gap-3 sm:grid-cols-2">
            {AMBIENTS.map((value) => (
              <AmbientChoice key={value} value={value} selected={ambient === value} onSelect={() => setAmbient(value)} />
            ))}
          </div>
        </section>

        <section className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <label htmlFor="appearance-motion" className="text-[13px] font-medium">
              {t("motion")}
            </label>
            <p className="text-xs text-muted-foreground">{t("motionHint")}</p>
          </div>
          <Switch id="appearance-motion" checked={motion === "on"} onCheckedChange={(on) => setMotion(on ? "on" : "off")} />
        </section>
      </CardContent>
    </Card>
  );
}

function AmbientChoice({ value, selected, onSelect }: { value: Ambient; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("appearance");
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group relative overflow-hidden rounded-2xl border text-left transition-[box-shadow,border-color,transform] duration-[var(--dur-panel)] active:scale-[0.99]",
        selected ? "border-transparent ring-2 ring-brand" : "hover:border-[var(--glass-border-strong)]",
      )}
    >
      <div className="relative h-28 overflow-hidden">
        <AmbientPreview ambient={value} />
        {/* A small pane of glass on the background, as the app will show it. */}
        <LiquidGlass material="card" reach={12} className="absolute bottom-3 left-3 flex h-9 w-[46%] items-center gap-2 rounded-[11px] border px-2.5">
          <span className="size-3 rounded-full bg-foreground/70" />
          <span className="h-1.5 flex-1 rounded-full bg-foreground/25" />
        </LiquidGlass>
        {selected ? (
          <span className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <CheckIcon className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className="glass-subtle space-y-0.5 px-3.5 py-2.5">
        <p className="text-[13px] font-medium">{t(value)}</p>
        <p className="text-xs text-muted-foreground">{t(`${value}Hint`)}</p>
      </div>
    </button>
  );
}
