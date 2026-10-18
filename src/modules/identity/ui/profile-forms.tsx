"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setLocale, updateMyProfile } from "../server/actions";
import { updateMyCardAction } from "@/modules/organizations/server/actions";

export function ProfileForms(props: {
  email: string;
  fullName: string;
  locale: "fr" | "en";
  jobTitle: string;
  expertise: string;
  optOut: boolean;
}) {
  const t = useTranslations("profile");
  const tShell = useTranslations("shell");
  const tErrors = useTranslations("errors");
  const [profileState, profileAction] = useActionState(updateMyProfile, null);
  const [cardState, cardAction] = useActionState(updateMyCardAction, null);
  const [localePending, startLocale] = useTransition();

  useEffect(() => {
    if (profileState?.ok) toast.success(t("saved"));
  }, [profileState, t]);
  useEffect(() => {
    if (cardState?.ok) toast.success(t("saved"));
  }, [cardState, t]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("accountTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={profileAction} className="space-y-5">
            <Field label={t("fullName")} htmlFor="fullName">
              <Input id="fullName" name="fullName" defaultValue={props.fullName} required maxLength={120} />
            </Field>
            <Field label={t("email")} htmlFor="email" hint={t("emailHint")}>
              <Input id="email" value={props.email} disabled readOnly />
            </Field>
            <Field label={tShell("language")} htmlFor="locale">
              <Select
                defaultValue={props.locale}
                disabled={localePending}
                onValueChange={(v) => startLocale(() => setLocale(v))}
              >
                <SelectTrigger id="locale" className="sm:w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fr">{tShell("french")}</SelectItem>
                  <SelectItem value="en">{tShell("english")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {profileState && !profileState.ok ? <FormMessage>{tErrors(profileState.error)}</FormMessage> : null}
            <div className="flex justify-end">
              <SubmitButton>{t("save")}</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("workTitle")}</CardTitle>
          <CardDescription>{t("workDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={cardAction} className="space-y-5">
            <Field label={t("jobTitle")} htmlFor="jobTitle">
              <Input id="jobTitle" name="jobTitle" defaultValue={props.jobTitle} maxLength={120} placeholder={t("jobTitlePlaceholder")} />
            </Field>
            <Field label={t("expertise")} htmlFor="expertise" hint={t("expertiseHint")}>
              <Input id="expertise" name="expertise" defaultValue={props.expertise} placeholder={t("expertisePlaceholder")} />
            </Field>
            <label className="flex items-start justify-between gap-6 rounded-lg border p-4">
              <span>
                <span className="block text-sm font-medium">{t("optOutLabel")}</span>
                <span className="block text-[13px] text-muted-foreground">{t("optOutHint")}</span>
              </span>
              <Switch name="optOut" defaultChecked={props.optOut} />
            </label>
            {cardState && !cardState.ok ? <FormMessage>{tErrors(cardState.error)}</FormMessage> : null}
            <div className="flex justify-end">
              <SubmitButton>{t("save")}</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
