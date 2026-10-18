"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { LayersIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PlanRow } from "../server/queries";
import { savePlanAction } from "../server/actions";

export function PlansManager({ header, plans }: { header: { title: string; description: string }; plans: PlanRow[] }) {
  const t = useTranslations("platform");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [editing, setEditing] = useState<PlanRow | "new" | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        className="pb-2"
        title={header.title}
        description={header.description}
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("newPlan")}
          </Button>
        }
      />
      {plans.length === 0 ? (
        <EmptyState icon={<LayersIcon />} title={t("noPlans")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {p.name}
                    {p.is_default ? <Badge variant="brand">{t("default")}</Badge> : null}
                    {!p.is_active ? <Badge variant="outline">{t("inactive")}</Badge> : null}
                  </p>
                  {p.price_label ? <p className="text-sm text-muted-foreground">{p.price_label}</p> : null}
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t("editPlan")} onClick={() => setEditing(p)}>
                  <PencilIcon />
                </Button>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-[12px] text-muted-foreground">{t("seatLimit")}</dt>
                  <dd className="tabular-nums">{p.seat_limit ?? t("unlimited")}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted-foreground">{t("monthlyCredits")}</dt>
                  <dd className="tabular-nums">{format.number(p.monthly_credits)}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted-foreground">{t("videoCredits")}</dt>
                  <dd className="tabular-nums">{format.number(p.video_credits)}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("newPlan") : t("editPlan")}</DialogTitle>
          </DialogHeader>
          {editing ? <PlanForm key={editing === "new" ? "new" : editing.id} plan={editing === "new" ? null : editing} onSaved={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanForm({ plan, onSaved }: { plan: PlanRow | null; onSaved: () => void }) {
  const t = useTranslations("platform");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [state, action] = useActionState(savePlanAction, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(t("planSaved"));
      onSaved();
    }
  }, [state, onSaved, t]);

  return (
    <form action={action} className="space-y-4">
      {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
      <Field label={t("planName")} htmlFor="plan-name">
        <Input id="plan-name" name="name" defaultValue={plan?.name ?? ""} required maxLength={80} />
      </Field>
      <Field label={t("priceLabel")} htmlFor="plan-price" hint={t("priceLabelHint")}>
        <Input id="plan-price" name="priceLabel" defaultValue={plan?.price_label ?? ""} maxLength={80} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("seatLimit")} htmlFor="plan-seats" hint={t("seatLimitHint")}>
          <Input id="plan-seats" name="seatLimit" type="number" min={0} defaultValue={plan?.seat_limit ?? ""} />
        </Field>
        <Field label={t("monthlyCredits")} htmlFor="plan-credits">
          <Input id="plan-credits" name="monthlyCredits" type="number" min={0} required defaultValue={plan?.monthly_credits ?? 0} />
        </Field>
        <Field label={t("videoCredits")} htmlFor="plan-video">
          <Input id="plan-video" name="videoCredits" type="number" min={0} required defaultValue={plan?.video_credits ?? 0} />
        </Field>
      </div>
      <label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
        <span>{t("defaultLabel")}</span>
        <Switch name="isDefault" defaultChecked={plan?.is_default ?? false} />
      </label>
      <label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
        <span>{t("activeLabel")}</span>
        <Switch name="isActive" defaultChecked={plan?.is_active ?? true} />
      </label>
      {state && !state.ok ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
      <div className="flex justify-end">
        <SubmitButton>{tCommon("save")}</SubmitButton>
      </div>
    </form>
  );
}
