"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRightIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEMPLATES } from "../templates";
import type { WorkflowSummary } from "../server/queries";
import { createWorkflowAction } from "../server/actions";

/** Workflows: start from a template or from scratch, and see one's workflows with their state. */
export function WorkflowsHome({ workflows, canShare }: { workflows: WorkflowSummary[]; canShare: boolean }) {
  const t = useTranslations("workflows");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [creating, setCreating] = React.useState<{ template: string | null } | null>(null);
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [pending, start] = React.useTransition();

  const open = (template: string | null) => {
    setName(template ? t(`template.${template}.name` as "template.email_digest.name") : "");
    setShared(false);
    setCreating({ template });
  };

  return (
    <div className="space-y-10">
      <section className="space-y-3" aria-labelledby="mine">
        <div className="flex items-center justify-between gap-3">
          <h2 id="mine" className="text-sm font-medium">
            {t("mine")}
          </h2>
          <Button size="sm" onClick={() => open(null)}>
            <PlusIcon />
            {t("new")}
          </Button>
        </div>
        {workflows.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="workflow-list">
            {workflows.map((w) => (
              <li key={w.id}>
                <Link href={`/workflows/${w.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60">
                  <WorkflowIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{w.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {w.scope === "company" ? t("scopeCompany") : t("scopePersonal")}
                      {w.lastRunAt ? ` · ${t("lastRun", { when: format.relativeTime(new Date(w.lastRunAt)) })}` : ""}
                      {w.lastRunStatus ? ` · ${t(`runStatus.${w.lastRunStatus as "succeeded"}`)}` : ""}
                    </span>
                  </span>
                  <Badge variant={w.status === "active" ? "brand" : "outline"}>{w.status === "active" ? t("statusActive") : t("statusPaused")}</Badge>
                  <ArrowRightIcon className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="templates">
        <h2 id="templates" className="text-sm font-medium">
          {t("templates")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((tpl) => (
            <button key={tpl.key} type="button" onClick={() => open(tpl.key)} className="rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/25" data-testid={`template-${tpl.key}`}>
              <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t(`templateCategory.${tpl.category}` as "templateCategory.email")}</span>
              <span className="mt-1 block text-sm font-medium">{t(`template.${tpl.key}.name` as "template.email_digest.name")}</span>
              <span className="mt-1 block text-[13px] text-muted-foreground">{t(`template.${tpl.key}.description` as "template.email_digest.description")}</span>
            </button>
          ))}
        </div>
      </section>

      <Dialog open={creating !== null} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent className="max-w-md" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{creating?.template ? t("useTemplate") : t("newTitle")}</DialogTitle>
            <DialogDescription>{t("newBody")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await createWorkflowAction({ name, template: creating?.template ?? null, scope: shared ? "company" : "personal" });
                if (!result.ok) {
                  toast.error(tErrors(result.error));
                  return;
                }
                router.push(`/workflows/${result.data!.id}`);
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">{t("name")}</Label>
              <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
            </div>
            {canShare ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-1" />
                <span>
                  {t("shareWithCompany")}
                  <span className="block text-xs text-muted-foreground">{t("shareWithCompanyBody")}</span>
                </span>
              </label>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(null)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {t("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
