"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, SunMoonIcon } from "lucide-react";
import { SegmentedControl } from "glisse";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { PALETTES } from "@/lib/ambient/palettes";
import { renderAmbientStill } from "@/lib/ambient/renderer";
import { isGlassTone, isTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useAppearance } from "./appearance-provider";
import { GLASS_KEY, PERF_KEY } from "./performance-guard";
import { WaylumePreview } from "@/components/ambient/waylume-layer";

/**
 * Settings → Appearance: Clair and Sombre (plain white or black, with glass), Système (follows the
 * device), or Atmosphère (glass over a living background, in the colours chosen here), and whether
 * that background moves. Each change shows at once and is kept on this device.
 */
export function AppearanceSettings() {
  const t = useTranslations("appearance");
  const { theme, ambient, motion, glassTone, setTheme, setAmbient, setMotion, setGlassTone } = useAppearance();
  const lowPower = useLowPower();

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
            items={[
              { value: "light", label: t("themeLight") },
              { value: "dark", label: t("themeDark") },
              { value: "system", label: t("themeSystem") },
              { value: "atmosphere", label: t("themeAtmosphere") },
            ]}
            value={theme}
            onValueChange={(value) => {
              if (isTheme(value)) setTheme(value);
            }}
          />
          <p className="text-xs text-muted-foreground">{t("interfaceHint")}</p>
        </section>

        {theme === "atmosphere" ? (
          <>
            <section className="space-y-2.5">
              <h4 className="text-[13px] font-medium" id="appearance-glass">
                {t("glass")}
              </h4>
              <SegmentedControl
                aria-labelledby="appearance-glass"
                items={[
                  { value: "clear", label: t("glassClear") },
                  { value: "tinted", label: t("glassTinted") },
                ]}
                value={glassTone}
                onValueChange={(value) => {
                  if (isGlassTone(value)) setGlassTone(value);
                }}
              />
              <p className="text-xs text-muted-foreground">{t("glassHint")}</p>
            </section>

            <section className="space-y-2.5">
              <h4 className="text-[13px] font-medium" id="appearance-colours">
                {t("colours")}
              </h4>
              <div role="radiogroup" aria-labelledby="appearance-colours" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {PALETTES.map((palette) => (
                  <PaletteChoice key={palette.id} palette={palette} selected={ambient === palette.id} onSelect={() => setAmbient(palette.id)} />
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
          </>
        ) : null}

        {lowPower.level ? (
          <div className="glass-subtle flex flex-col gap-3 rounded-xl border px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between" role="status">
            <p className="text-muted-foreground">{lowPower.level === "low" ? t("lowPower") : t("glassFlat")}</p>
            <Button type="button" size="sm" variant="outline" onClick={lowPower.restore}>
              {t("lowPowerRestore")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Still images of each palette, drawn once per visit by the same shader as the background. */
const stills = new Map<string, string | null>();

function PaletteChoice({ palette, selected, onSelect }: { palette: (typeof PALETTES)[number]; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("appearance");
  const [src, setSrc] = React.useState<string | null>(() => stills.get(palette.id) ?? null);
  React.useEffect(() => {
    // The Waylume scene draws its own still frame in the tile (below); ours are drawn once here.
    if (palette.scene === "waylume" || stills.has(palette.id)) return;
    const id = window.setTimeout(() => {
      const url = renderAmbientStill(palette, 360, 220);
      stills.set(palette.id, url);
      setSrc(url);
    }, 0);
    return () => window.clearTimeout(id);
  }, [palette]);

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
      <div
        className="relative h-24 overflow-hidden"
        style={{ background: `linear-gradient(160deg, ${palette.colors.c2}, ${palette.colors.base} 70%)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL drawn in the browser */}
        {palette.scene === "waylume" ? <WaylumePreview variant={palette.id} /> : src ? <img src={src} alt="" className="absolute inset-0 size-full object-cover" /> : null}
        <LiquidGlass
          material="card"
          reach={12}
          className={cn(
            "absolute bottom-2.5 left-2.5 flex h-8 w-[52%] items-center gap-2 rounded-[10px] border px-2.5",
            palette.scheme === "light" ? "text-black/70" : "text-white/80",
          )}
        >
          <span className="size-2.5 rounded-full bg-current" />
          <span className="h-1 flex-1 rounded-full bg-current opacity-40" />
        </LiquidGlass>
        {selected ? (
          <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <CheckIcon className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className="glass-subtle space-y-0.5 px-3 py-2">
        <p className="text-[13px] font-medium">{t(`palette.${palette.id}`)}</p>
        <p className="text-[11.5px] text-muted-foreground">{t(`paletteHint.${palette.id}`)}</p>
      </div>
    </button>
  );
}

function subscribeEffects(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-perf", "data-glass"] });
  return () => observer.disconnect();
}

function effectsLevel(): "low" | "flat" | null {
  const root = document.documentElement;
  if (root.dataset.perf === "low") return "low";
  return root.dataset.glass === "flat" ? "flat" : null;
}

/**
 * Whether this device's effects were reduced ("low": no graphics chip, still background and unbent
 * glass; "flat": only the glass's bending is off), and a way to turn them back on for this tab.
 */
function useLowPower() {
  const level = React.useSyncExternalStore(subscribeEffects, effectsLevel, () => null);
  return {
    level,
    restore() {
      try {
        sessionStorage.setItem(PERF_KEY, "ok");
        sessionStorage.setItem(GLASS_KEY, "ok");
      } catch {
        // Not remembered: the effects come back for this page only.
      }
      delete document.documentElement.dataset.perf;
      delete document.documentElement.dataset.glass;
    },
  };
}
