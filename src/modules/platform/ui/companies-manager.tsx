"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { BuildingIcon, CoinsIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyLinkButton } from "@/modules/organizations/ui/invite-form";
import { createCompanyForCustomerAction, updateCompanyForPlatformAction } from "../server/actions";
import { grantCreditsAction } from "@/modules/usage/server/actions";

type Company = {
  id: string;
  name: string;
  status: "active" | "suspended";
  planId: string | null;
  planName: string | null;
  seatLimit: number | null;
  activeSeats: number;
  pendingInvitations: number;
  ownerEmail: string | null;
  createdAt: string;
  /** This month: credits used / limit (plan + extra) and estimated AI cost. Metadata only. */
  credits: { used: number; limit: number; estimatedCostUsd: number; requests: number } | null;
};

export function CompaniesManager({
  header,
  companies,
  plans,
}: {
  header: { title: string; description: string };
  companies: Company[];
  plans: { id: string; name: string }[];
}) {
  const t = useTranslations("platform");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState<Company | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (input: Parameters<typeof updateCompanyForPlatformAction>[0]) =>
    startTransition(async () => {
      const result = await updateCompanyForPlatformAction(input);
      if (result.ok) toast.success(t("updated"));
      else toast.error(tErrors(result.error));
    });

  return (
    <div className="space-y-6">
      <PageHeader
        className="pb-2"
        title={header.title}
        description={header.description}
        actions={
          <Button onClick={() => setCreating(true)} disabled={plans.length === 0}>
            <PlusIcon />
            {t("createCompany")}
          </Button>
        }
      />

      {companies.length === 0 ? (
        <EmptyState icon={<BuildingIcon />} title={t("noCompanies")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b text-left text-[13px] text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("colCompany")}</th>
                <th className="px-4 py-2.5 font-medium">{t("colPlan")}</th>
                <th className="px-4 py-2.5 font-medium">{t("colSeats")}</th>
                <th className="px-4 py-2.5 font-medium">{t("colCredits")}</th>
                <th className="px-4 py-2.5 font-medium">{t("colCreated")}</th>
                <th className="px-4 py-2.5 font-medium">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {companies.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-[13px] text-muted-foreground">{c.ownerEmail ?? t("noOwner")}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={c.planId ?? undefined} disabled={pending} onValueChange={(v) => update({ companyId: c.id, planId: v })}>
                      <SelectTrigger className="h-8 w-44 text-[13px]" aria-label={t("colPlan")}>
                        <SelectValue placeholder={t("noPlan")} />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {c.seatLimit ? t("seatsValue", { used: c.activeSeats, limit: c.seatLimit }) : c.activeSeats}
                    {c.pendingInvitations > 0 ? (
                      <span className="ml-1.5 text-[13px] text-muted-foreground">{t("pending", { count: c.pendingInvitations })}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <div className="min-w-0">
                        <p className="tabular-nums">
                          {c.credits
                            ? t("creditsValue", {
                                used: format.number(c.credits.used, { maximumFractionDigits: 0 }),
                                limit: format.number(c.credits.limit, { maximumFractionDigits: 0 }),
                              })
                            : "—"}
                        </p>
                        {c.credits ? (
                          <p className="text-[13px] text-muted-foreground">
                            {t("estimatedCost", { cost: format.number(c.credits.estimatedCostUsd, { style: "currency", currency: "USD" }) })}
                          </p>
                        ) : null}
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label={t("grantCredits")} onClick={() => setGranting(c)}>
                        <CoinsIcon />
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">
                    {format.dateTime(new Date(c.createdAt), { dateStyle: "medium" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={c.status === "active" ? "success" : "destructive"}>{t(`status_${c.status}`)}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => update({ companyId: c.id, status: c.status === "active" ? "suspended" : "active" })}
                      >
                        {c.status === "active" ? t("suspend") : t("reactivate")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-[13px] text-muted-foreground">{t("contentNotice")}</p>

      <Dialog open={granting !== null} onOpenChange={(open) => !open && setGranting(null)}>
        <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{t("grantTitle", { company: granting?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("grantDescription")}</DialogDescription>
          </DialogHeader>
          {granting ? <GrantCreditsForm companyId={granting.id} onDone={() => setGranting(null)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          <CreateCompanyForm plans={plans} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateCompanyForm({ plans }: { plans: { id: string; name: string }[] }) {
  const t = useTranslations("platform");
  const tErrors = useTranslations("errors");
  const [state, action] = useActionState(createCompanyForCustomerAction, null);

  if (state?.ok && state.data) {
    return (
      <div className="space-y-4">
        <FormMessage tone="success">{state.data.emailSent ? t("ownerInvited") : t("ownerNotEmailed")}</FormMessage>
        <CopyLinkButton link={state.data.link} />
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <Field label={t("companyName")} htmlFor="pc-name">
        <Input id="pc-name" name="name" required maxLength={120} />
      </Field>
      <Field label={t("ownerEmail")} htmlFor="pc-owner">
        <Input id="pc-owner" name="ownerEmail" type="email" required />
      </Field>
      <Field label={t("colPlan")} htmlFor="pc-plan">
        <Select name="planId" defaultValue={plans[0]?.id} required>
          <SelectTrigger id="pc-plan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {state && !state.ok ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
      <div className="flex justify-end">
        <SubmitButton>{t("create")}</SubmitButton>
      </div>
    </form>
  );
}

function GrantCreditsForm({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const t = useTranslations("platform");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const credits = Number(form.get("credits"));
        if (!Number.isFinite(credits) || credits <= 0) return;
        startTransition(async () => {
          const pool = form.get("pool") === "video" ? "video" : "standard";
          const result = await grantCreditsAction({ companyId, credits, note: String(form.get("note") ?? "") || undefined, pool });
          if (result.ok) {
            toast.success(t("granted"));
            onDone();
          } else toast.error(tErrors(result.error));
        });
      }}
    >
      <Field label={t("grantCreditsLabel")} htmlFor="grant-credits">
        <Input id="grant-credits" name="credits" type="number" min={1} required autoFocus />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t("grantPool")}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="pool" value="standard" defaultChecked className="accent-brand" />
            {t("grantPoolStandard")}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="pool" value="video" className="accent-brand" />
            {t("grantPoolVideo")}
          </label>
        </div>
      </fieldset>
      <Field label={t("grantNote")} htmlFor="grant-note">
        <Input id="grant-note" name="note" maxLength={200} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pending={pending}>{t("grantCredits")}</SubmitButton>
      </div>
    </form>
  );
}
