"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { BuildingIcon, PlusIcon } from "lucide-react";
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
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-[13px] text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("colCompany")}</th>
                <th className="px-4 py-2.5 font-medium">{t("colPlan")}</th>
                <th className="px-4 py-2.5 font-medium">{t("colSeats")}</th>
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
