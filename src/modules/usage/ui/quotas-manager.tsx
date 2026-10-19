"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { PencilIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, Spinner } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { QUOTA_WARNING_RATIO } from "../quota";
import { setDefaultUserQuotaAction, setMemberQuotaAction } from "../server/actions";

type Member = { userId: string; name: string; email: string; avatarUrl: string | null; used: number; limit: number | null; hasOverride: boolean };

export function QuotasManager({
  company,
  defaultLimit,
  members,
}: {
  company: { limit: number; used: number; planCredits: number; extraCredits: number };
  defaultLimit: number | null;
  members: Member[];
}) {
  const t = useTranslations("quotas");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const [editing, setEditing] = React.useState<Member | null>(null);
  const [savingDefault, startSavingDefault] = React.useTransition();
  const [defaultValue, setDefaultValue] = React.useState(defaultLimit === null ? "" : String(defaultLimit));
  const credits = (v: number) => format.number(v, { maximumFractionDigits: 0 });

  const saveDefault = () =>
    startSavingDefault(async () => {
      const value = defaultValue.trim() === "" ? null : Number(defaultValue);
      if (value !== null && (!Number.isFinite(value) || value < 0)) return;
      const result = await setDefaultUserQuotaAction({ credits: value });
      if (result.ok) toast.success(t("saved"));
      else toast.error(tErrors(result.error));
    });

  return (
    <div className="space-y-8">
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">{t("companyTitle")}</p>
          <p className="text-sm tabular-nums">{t("usedOf", { used: credits(company.used), limit: credits(company.limit) })}</p>
        </div>
        <Meter used={company.used} limit={company.limit} className="mt-3" />
        <p className="mt-3 text-[13px] text-muted-foreground">
          {t("companyBody", { plan: credits(company.planCredits) })}
          {company.extraCredits > 0 ? ` ${t("extraCredits", { extra: credits(company.extraCredits) })}` : ""}
        </p>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <p className="text-sm font-medium">{t("defaultTitle")}</p>
          <p className="text-[13px] text-muted-foreground">{t("defaultBody")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("creditsPerMonth")} htmlFor="default-quota" className="w-56">
            <Input
              id="default-quota"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder={t("noLimit")}
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
            />
          </Field>
          <Button onClick={saveDefault} disabled={savingDefault || defaultValue === (defaultLimit === null ? "" : String(defaultLimit))}>
            {savingDefault ? <Spinner /> : null}
            {t("save")}
          </Button>
        </div>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">{t("membersTitle")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("membersBody")}</p>
        </div>
        <Card className="divide-y overflow-hidden">
          {members.map((m) => (
            <div key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
              <Avatar name={m.name} src={m.avatarUrl} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {m.limit === null ? t("usedNoLimit", { used: credits(m.used) }) : t("usedOf", { used: credits(m.used), limit: credits(m.limit) })}
                </p>
              </div>
              {m.limit !== null ? <Meter used={m.used} limit={m.limit} className="w-32" /> : null}
              {m.hasOverride ? <Badge variant="brand">{t("personal")}</Badge> : null}
              <Button variant="ghost" size="icon-sm" aria-label={t("editLimit", { name: m.name })} onClick={() => setEditing(m)}>
                <PencilIcon />
              </Button>
            </div>
          ))}
        </Card>
      </section>

      <MemberLimitDialog member={editing} defaultLimit={defaultLimit} onClose={() => setEditing(null)} />
    </div>
  );
}

function Meter({ used, limit, className }: { used: number; limit: number; className?: string }) {
  const ratio = limit > 0 ? used / limit : used > 0 ? 1 : 0;
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-[width]", ratio >= 1 ? "bg-destructive" : ratio >= QUOTA_WARNING_RATIO ? "bg-warning" : "bg-brand")}
        style={{ width: `${Math.min(ratio * 100, 100)}%` }}
      />
    </div>
  );
}

function MemberLimitDialog({ member, defaultLimit, onClose }: { member: Member | null; defaultLimit: number | null; onClose: () => void }) {
  const t = useTranslations("quotas");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [saving, startSaving] = React.useTransition();

  const submit = (credits: number | null) =>
    startSaving(async () => {
      if (!member) return;
      const result = await setMemberQuotaAction({ userId: member.userId, credits });
      if (result.ok) {
        toast.success(t("saved"));
        onClose();
      } else toast.error(tErrors(result.error));
    });

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("limitFor", { name: member?.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {defaultLimit === null ? t("dialogNoDefault") : t("dialogDefault", { limit: format.number(defaultLimit) })}
          </DialogDescription>
        </DialogHeader>
        {member ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(new FormData(e.currentTarget).get("credits"));
              if (Number.isFinite(value) && value >= 0) submit(value);
            }}
          >
            <Field label={t("creditsPerMonth")} htmlFor="member-quota">
              <Input id="member-quota" name="credits" type="number" min={0} required defaultValue={member.hasOverride ? (member.limit ?? "") : ""} autoFocus />
            </Field>
            <DialogFooter className="sm:justify-between">
              {member.hasOverride ? (
                <Button type="button" variant="ghost" disabled={saving} onClick={() => submit(null)}>
                  {t("useDefault")}
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
