"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon, LayoutTemplateIcon, LoaderCircleIcon, SquareDashedIcon, TrendingUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { starterPlan } from "../templates";
import { useScaleActions } from "./store";

/**
 * First visit: start empty or with the Cendr starting structure (suggestions only: no dates, no
 * results, no customers). Only what helps planning is asked, and all of it can be skipped.
 */
export function Onboarding() {
  const t = useTranslations("scale.onboarding");
  const locale = useLocale() === "en" ? "en" : "fr";
  const actions = useScaleActions();
  const [mode, setMode] = React.useState<"cendr" | "empty">("cendr");
  const [capacity, setCapacity] = React.useState("");
  const [team, setTeam] = React.useState("");
  const [launch, setLaunch] = React.useState("");
  const [busy, setBusy] = React.useState<null | "start" | "skip">(null);
  const plan = React.useMemo(() => starterPlan(locale), [locale]);

  async function start(skip: boolean) {
    setBusy(skip ? "skip" : "start");
    const hours = capacity.trim() ? Number(capacity.replace(",", ".")) : null;
    const values = skip ? {} : { weekly_capacity_hours: hours !== null && Number.isFinite(hours) && hours >= 0 && hours <= 168 ? hours : null, team_note: team.trim() || null, launch_target: launch || null };
    await actions.start(skip ? "empty" : mode, values);
    setBusy(null);
  }

  const choice = (value: "cendr" | "empty", icon: React.ReactNode, title: string, text: string, extra?: React.ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      onClick={() => setMode(value)}
      className={cn(
        "flex flex-col rounded-2xl border p-5 text-left outline-none transition-[border-color,box-shadow,background-color] focus-visible:ring-2 focus-visible:ring-ring",
        mode === value ? "border-foreground bg-card shadow-sm" : "hover:border-foreground/30 hover:bg-card/60",
      )}
    >
      <span className="flex items-center justify-between">
        <span className="flex size-9 items-center justify-center rounded-xl bg-muted [&_svg]:size-4">{icon}</span>
        <span className={cn("flex size-5 items-center justify-center rounded-full border", mode === value && "border-foreground bg-foreground text-background")}>{mode === value ? <CheckIcon className="size-3" /> : null}</span>
      </span>
      <span className="mt-4 font-semibold">{title}</span>
      <span className="mt-1 text-sm text-muted-foreground">{text}</span>
      {extra}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8 sm:py-16">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
        <TrendingUpIcon className="size-5" />
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-[-0.025em]">{t("title")}</h1>
      <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">{t("intro")}</p>

      <div role="radiogroup" aria-label={t("choose")} className="mt-8 grid gap-3 sm:grid-cols-2">
        {choice(
          "cendr",
          <LayoutTemplateIcon />,
          t("cendr.title"),
          t("cendr.text"),
          <ul className="mt-4 space-y-1 text-[13px] text-muted-foreground">
            {plan.projects.map((p, i) => (
              <li key={p.key} className="flex gap-2">
                <span className="w-4 shrink-0 tabular-nums">{`${i + 1}.`}</span>
                <span>{p.title}</span>
              </li>
            ))}
          </ul>,
        )}
        {choice("empty", <SquareDashedIcon />, t("empty.title"), t("empty.text"))}
      </div>

      <div className="mt-8 rounded-2xl border bg-card/50 p-5">
        <p className="font-medium">{t("planning.title")}</p>
        <p className="text-sm text-muted-foreground">{t("planning.text")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">{t("planning.capacity")}</span>
            <Input type="number" inputMode="decimal" min={0} max={168} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder={t("planning.capacityPlaceholder")} />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">{t("planning.team")}</span>
            <Input value={team} maxLength={500} onChange={(e) => setTeam(e.target.value)} placeholder={t("planning.teamPlaceholder")} />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">{t("planning.launch")}</span>
            <Input type="date" value={launch} onChange={(e) => setLaunch(e.target.value)} />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("planning.note")}</p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => void start(false)} disabled={busy !== null}>
          {busy === "start" ? <LoaderCircleIcon className="animate-spin" /> : null}
          {mode === "cendr" ? t("startCendr") : t("startEmpty")}
        </Button>
        <Button size="lg" variant="ghost" onClick={() => void start(true)} disabled={busy !== null}>
          {busy === "skip" ? <LoaderCircleIcon className="animate-spin" /> : null}
          {t("skip")}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("later")}</p>
    </div>
  );
}
