"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellIcon, CalendarClockIcon, CircleSlashIcon, FlagIcon, FlaskConicalIcon, ScaleIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { addDays } from "../logic/dates";
import { useDates } from "./primitives";
import { useIndex } from "./selectors";
import { usePanel, useScale } from "./store";

export type Alert = { key: string; kind: "overdue" | "due_soon" | "blocked" | "milestone" | "review" | "test"; title: string; date: string | null; go: () => void };

/** What needs attention now: computed from the records, nothing to set up and nothing stored. */
export function useAlerts(): Alert[] {
  const index = useIndex();
  const data = useScale();
  const panel = usePanel();
  const router = useRouter();
  return React.useMemo(() => {
    const out: Alert[] = [];
    const soon = addDays(index.today, 2);
    for (const t of index.openTasks) {
      if (t.status === "blocked" || index.blockersOf(t.id).length) out.push({ key: `b-${t.id}`, kind: "blocked", title: t.title, date: t.due_date, go: () => panel.open("task", t.id) });
      else if (t.due_date && t.due_date < index.today) out.push({ key: `o-${t.id}`, kind: "overdue", title: t.title, date: t.due_date, go: () => panel.open("task", t.id) });
      else if (t.due_date && t.due_date <= soon) out.push({ key: `s-${t.id}`, kind: "due_soon", title: t.title, date: t.due_date, go: () => panel.open("task", t.id) });
    }
    for (const m of index.milestones) {
      if (!m.achieved_date && m.target_date && m.target_date < index.today) out.push({ key: `m-${m.id}`, kind: "milestone", title: m.title, date: m.target_date, go: () => panel.open("milestone", m.id) });
    }
    for (const d of data.decisions) {
      if (!d.archived_at && d.review_on && d.review_on <= index.today) out.push({ key: `d-${d.id}`, kind: "review", title: d.subject, date: d.review_on, go: () => panel.open("decision", d.id) });
    }
    for (const t of index.tests) {
      if (t.status === "running" && t.end_date && t.end_date < index.today) out.push({ key: `t-${t.id}`, kind: "test", title: t.title, date: t.end_date, go: () => router.push(`/scale/tests/${t.id}`) });
    }
    return out;
  }, [index, data.decisions, panel, router]);
}

const ICON: Record<Alert["kind"], React.ComponentType<{ className?: string }>> = {
  overdue: CalendarClockIcon,
  due_soon: CalendarClockIcon,
  blocked: CircleSlashIcon,
  milestone: FlagIcon,
  review: ScaleIcon,
  test: FlaskConicalIcon,
};

export function NotificationsMenu({ className }: { className?: string }) {
  const t = useTranslations("scale.alerts");
  const alerts = useAlerts();
  const dates = useDates();
  const urgent = alerts.filter((a) => a.kind !== "due_soon").length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={alerts.length ? t("buttonCount", { count: alerts.length }) : t("button")}
        className={cn("relative inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <BellIcon className="size-4" />
        {alerts.length ? (
          <span className={cn("absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums", urgent ? "bg-destructive text-white" : "bg-foreground text-background")}>
            {alerts.length > 99 ? "99+" : alerts.length}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t("title")}</DropdownMenuLabel>
        {alerts.length === 0 ? <p className="px-2 pb-3 pt-1 text-sm text-muted-foreground">{t("empty")}</p> : null}
        {alerts.slice(0, 40).map((a) => {
          const Icon = ICON[a.kind];
          return (
            <DropdownMenuItem key={a.key} onSelect={a.go} className="items-start">
              <Icon className={cn("mt-0.5", a.kind === "blocked" || a.kind === "overdue" || a.kind === "milestone" ? "!text-destructive" : a.kind === "due_soon" ? "!text-warning" : "")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`kinds.${a.kind}`)}
                  {a.date ? ` · ${dates.short(a.date)}` : ""}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
