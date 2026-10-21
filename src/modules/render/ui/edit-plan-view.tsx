"use client";

import { useTranslations } from "next-intl";
import { FilmIcon, TypeIcon } from "lucide-react";
import { planDuration, type EditPlan } from "../edit-plan";

/** The Video Editor's plan, readable: cuts in order, on-screen texts, total length. */
export function EditPlanView({ plan }: { plan: EditPlan }) {
  const t = useTranslations("render");
  const time = (seconds: number) =>
    seconds < 60 ? t("seconds", { value: Math.round(seconds * 10) / 10 }) : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
  return (
    <section aria-label={t("planTitle")} className="not-prose my-4 rounded-lg border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <h3 className="text-[13px] font-medium">{plan.title || t("planTitle")}</h3>
        <span className="text-xs text-muted-foreground">{t("planSummary", { segments: plan.segments.length, duration: time(planDuration(plan)) })}</span>
      </header>
      <ol className="divide-y text-[13px]">
        {plan.segments.map((s, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <FilmIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{s.clip}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{t("range", { start: time(s.start), end: time(s.end) })}</span>
          </li>
        ))}
      </ol>
      {plan.captions.length ? (
        <div className="border-t px-4 py-2.5">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("planCaptions")}</p>
          <ul className="space-y-1 text-[13px]">
            {plan.captions.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <TypeIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{c.text}</span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{t("range", { start: time(c.start), end: time(c.end) })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
