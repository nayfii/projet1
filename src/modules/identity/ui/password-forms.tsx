"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRoundIcon, MailIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { requestPasswordResetAction, setPasswordAction } from "../server/password-actions";

/** "Forgot password": the address, then always the same answer (never tells whether an account exists). */
export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const [state, action] = useActionState(requestPasswordResetAction, null);
  const sentTo = state?.ok ? state.data?.email : null;

  if (sentTo) {
    return (
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <MailIcon className="size-5" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{t("forgotSentTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("forgotSentBody", { email: sentTo })}</p>
        </div>
        <Link href="/login" className="inline-block text-sm text-muted-foreground hover:text-foreground">
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }
  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("forgotTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("forgotSubtitle")}</p>
      </div>
      <form action={action} className="space-y-4">
        <Field label={t("emailLabel")} htmlFor="email" error={state && !state.ok ? tErrors(state.error) : undefined}>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus placeholder={t("emailPlaceholder")} className="h-10" />
        </Field>
        <SubmitButton className="h-10 w-full">{t("forgotSend")}</SubmitButton>
      </form>
      <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">
        {t("backToSignIn")}
      </Link>
    </div>
  );
}

/** After the "forgot password" link: the new password, then on into the app. */
export function ResetPasswordForm({ email }: { email: string }) {
  const t = useTranslations("auth");
  const tPassword = useTranslations("password");
  const tErrors = useTranslations("errors");
  const [state, action] = useActionState(setPasswordAction, null);
  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("resetTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("resetSubtitle", { email })}</p>
      </div>
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value="/" />
        <NewPasswordFields />
        {state && !state.ok ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
        <SubmitButton className="h-10 w-full">{t("resetSave")}</SubmitButton>
      </form>
      <p className="text-center text-xs text-muted-foreground">{tPassword("rule")}</p>
    </div>
  );
}

/** Profile: create a password (signed in with a link until now) or change it. */
export function PasswordCard({ hasPassword, needsCurrent }: { hasPassword: boolean; needsCurrent: boolean }) {
  const t = useTranslations("password");
  const tAuth = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const [state, action] = useActionState(setPasswordAction, null);
  const formRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (state?.ok) {
      toast.success(t("saved"));
      formRef.current?.reset();
    }
  }, [state, t]);
  return (
    <Card id="password">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{hasPassword ? t("descriptionSet") : t("descriptionNone")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="space-y-4">
          {needsCurrent ? (
            <Field label={t("current")} htmlFor="current-password">
              <PasswordInput id="current-password" name="current" autoComplete="current-password" required showLabel={tAuth("showPassword")} hideLabel={tAuth("hidePassword")} />
            </Field>
          ) : null}
          <NewPasswordFields />
          {state && !state.ok ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t("rule")}</p>
            <SubmitButton>{hasPassword ? t("change") : t("create")}</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NewPasswordFields() {
  const t = useTranslations("password");
  const tAuth = useTranslations("auth");
  return (
    <>
      <Field label={t("new")} htmlFor="new-password">
        <PasswordInput id="new-password" name="password" autoComplete="new-password" required minLength={10} showLabel={tAuth("showPassword")} hideLabel={tAuth("hidePassword")} />
      </Field>
      <Field label={t("confirm")} htmlFor="confirm-password">
        <PasswordInput id="confirm-password" name="confirm" autoComplete="new-password" required minLength={10} showLabel={tAuth("showPassword")} hideLabel={tAuth("hidePassword")} />
      </Field>
    </>
  );
}
