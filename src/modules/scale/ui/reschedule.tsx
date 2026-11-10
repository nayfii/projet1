"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cascadePlan, type DateChange, type Span } from "../logic/planning";
import { useDates } from "./primitives";
import { useIndex } from "./selectors";
import { useScaleActions } from "./store";

type Kind = "task" | "project";
type Pending = { kind: Kind; changes: DateChange[] };

const RescheduleContext = React.createContext<(kind: Kind, id: string, to: { start: string | null; end: string | null }) => void>(() => {});

/**
 * Moving dates. When the move pushes items that depend on it, the consequences are shown first: apply
 * with the cascade, move only this item, or cancel. Nothing is moved silently.
 */
export function RescheduleProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("scale.reschedule");
  const tc = useTranslations("scale.common");
  const index = useIndex();
  const actions = useScaleActions();
  const dates = useDates();
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reschedule = React.useCallback(
    (kind: Kind, id: string, to: { start: string | null; end: string | null }) => {
      const spans: Span[] =
        kind === "project"
          ? index.projects.map((p) => ({ id: p.id, start: p.start_date, end: p.target_date }))
          : index.tasks.map((x) => ({ id: x.id, start: x.start_date, end: x.due_date }));
      const edges = kind === "project" ? index.projectEdges : index.taskEdges;
      const plan = cascadePlan(spans, edges, id, to);
      if (plan.length <= 1) void actions.applyDates(kind, plan.length ? plan : [{ id, from: { start: null, end: null }, to, because: null }]);
      else setPending({ kind, changes: plan });
    },
    [index, actions],
  );

  const name = (kind: Kind, id: string) => (kind === "project" ? index.projectById.get(id)?.title : index.taskById.get(id)?.title) ?? "—";
  const span = (s: { start: string | null; end: string | null }) => [s.start ? dates.short(s.start) : null, s.end ? dates.short(s.end) : null].filter(Boolean).join(" → ") || "—";

  async function apply(all: boolean) {
    if (!pending) return;
    setBusy(true);
    const ok = await actions.applyDates(pending.kind, all ? pending.changes : pending.changes.slice(0, 1));
    setBusy(false);
    if (ok) setPending(null);
  }

  return (
    <RescheduleContext.Provider value={reschedule}>
      {children}
      <Dialog open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent closeLabel={tc("close")} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description", { count: (pending?.changes.length ?? 1) - 1 })}</DialogDescription>
          </DialogHeader>
          {pending ? (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {pending.changes.map((c, i) => (
                <li key={c.id} className="rounded-lg border px-3 py-2 text-sm">
                  <p className="truncate font-medium">{name(pending.kind, c.id)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{span(c.from)}</span>
                    <ArrowRightIcon className="size-3" />
                    <span className="text-foreground">{span(c.to)}</span>
                    {i > 0 && c.because ? <span>· {t("because", { name: name(pending.kind, c.because) })}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="outline" onClick={() => void apply(false)} disabled={busy}>
              {t("onlyThis")}
            </Button>
            <Button onClick={() => void apply(true)} disabled={busy}>
              {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
              {t("all", { count: pending?.changes.length ?? 0 })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RescheduleContext.Provider>
  );
}

export const useReschedule = () => React.useContext(RescheduleContext);
