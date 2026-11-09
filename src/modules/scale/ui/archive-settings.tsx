"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArchiveRestoreIcon, DownloadIcon, LayoutTemplateIcon, LoaderCircleIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Entity } from "../types";
import { ScalePageHeader, useDates } from "./primitives";
import { useScale, useScaleActions } from "./store";

/** Everything archived in Scale, ready to come back. Permanent deletion happens only from here. */
export function ArchivePage() {
  const t = useTranslations("scale");
  const data = useScale();
  const actions = useScaleActions();
  const dates = useDates();
  const groups: { entity: Entity; items: { id: string; title: string; archived_at: string }[] }[] = [
    { entity: "objective", items: data.objectives.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.title, archived_at: x.archived_at! })) },
    { entity: "project", items: data.projects.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.title, archived_at: x.archived_at! })) },
    { entity: "milestone", items: data.milestones.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.title, archived_at: x.archived_at! })) },
    { entity: "task", items: data.tasks.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.title, archived_at: x.archived_at! })) },
    { entity: "test", items: data.tests.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.title, archived_at: x.archived_at! })) },
    { entity: "document", items: data.documents.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.title, archived_at: x.archived_at! })) },
    { entity: "decision", items: data.decisions.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.subject, archived_at: x.archived_at! })) },
    { entity: "metric", items: data.metrics.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.name, archived_at: x.archived_at! })) },
    { entity: "simulation", items: data.simulations.filter((x) => x.archived_at).map((x) => ({ id: x.id, title: x.name, archived_at: x.archived_at! })) },
  ];
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <ScalePageHeader title={t("archive.title")} description={t("archive.description")} />
      {total === 0 ? <div className="rounded-2xl border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">{t("archive.empty")}</div> : null}
      <div className="space-y-6">
        {groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section key={g.entity} aria-label={t(`archive.types.${g.entity}`)}>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`archive.types.${g.entity}`)} <span className="tabular-nums">{g.items.length}</span>
              </h2>
              <ul className="divide-y rounded-2xl border">
                {g.items.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{x.title}</span>
                    <span className="text-xs text-muted-foreground">{t("archive.archivedOn", { when: dates.relative(x.archived_at) })}</span>
                    <Button size="sm" variant="outline" onClick={() => void actions.archive(g.entity, x.id, false)}>
                      <ArchiveRestoreIcon />
                      {t("panel.restore")}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("archive.deleteFor", { title: x.title })}
                      onClick={async () => {
                        if (window.confirm(t("panel.deleteConfirm"))) await actions.remove(g.entity, x.id);
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}

/** Scale's settings: weekly capacity, the optional launch target, starting points and exports. */
export function SettingsPage() {
  const t = useTranslations("scale.settings");
  const data = useScale();
  const actions = useScaleActions();
  const s = data.settings;
  const [capacity, setCapacity] = React.useState(s?.weekly_capacity_hours === null || s?.weekly_capacity_hours === undefined ? "" : String(s.weekly_capacity_hours));
  const [team, setTeam] = React.useState(s?.team_note ?? "");
  const [launch, setLaunch] = React.useState(s?.launch_target ?? "");
  const [busy, setBusy] = React.useState<null | "save" | "starter">(null);
  const hours = capacity.trim() ? Number(capacity.replace(",", ".")) : null;
  const invalid = hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 168);
  const hasStarter = data.projects.some((p) => p.template_key);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <ScalePageHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        <section className="rounded-2xl border p-5">
          <h2 className="font-semibold">{t("planning")}</h2>
          <form
            className="mt-4 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (invalid) return;
              setBusy("save");
              await actions.saveSettings({ weekly_capacity_hours: hours, team_note: team.trim() || null, launch_target: launch || null });
              setBusy(null);
            }}
          >
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">{t("capacity")}</span>
              <Input type="number" inputMode="decimal" min={0} max={168} value={capacity} onChange={(e) => setCapacity(e.target.value)} aria-invalid={invalid || undefined} className="max-w-40" />
              <span className="block text-xs text-muted-foreground">{t("capacityHint")}</span>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">{t("team")}</span>
              <Input value={team} maxLength={500} onChange={(e) => setTeam(e.target.value)} placeholder={t("teamPlaceholder")} />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">{t("launch")}</span>
              <Input type="date" value={launch} onChange={(e) => setLaunch(e.target.value)} className="max-w-52" />
              <span className="block text-xs text-muted-foreground">{t("launchHint")}</span>
            </label>
            <Button type="submit" size="sm" disabled={invalid || busy !== null}>
              {busy === "save" ? <LoaderCircleIcon className="animate-spin" /> : null}
              {t("save")}
            </Button>
          </form>
        </section>

        <section className="rounded-2xl border p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <LayoutTemplateIcon className="size-4 text-muted-foreground" />
            {t("starterTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{hasStarter ? t("starterDone") : t("starterText")}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("starter");
              await actions.addStarter();
              setBusy(null);
            }}
          >
            {busy === "starter" ? <LoaderCircleIcon className="animate-spin" /> : null}
            {hasStarter ? t("starterAgain") : t("starterAdd")}
          </Button>
        </section>

        <section className="rounded-2xl border p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <DownloadIcon className="size-4 text-muted-foreground" />
            {t("exportTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("exportText")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href="/api/scale/export?format=json" download>
                {t("exportJson")}
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="/api/scale/export?format=tasks" download>
                {t("exportTasks")}
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="/api/scale/export?format=tests" download>
                {t("exportTests")}
              </a>
            </Button>
          </div>
        </section>

        <section className="flex items-start gap-3 rounded-2xl bg-muted/50 p-5 text-sm">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">{t("access")}</p>
        </section>
      </div>
    </div>
  );
}
