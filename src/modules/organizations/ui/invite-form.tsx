"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, MailIcon, TriangleAlertIcon } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, SubmitButton } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteMembersAction } from "../server/actions";
import { AVAILABLE_SCOPES, ADMIN_SCOPES } from "../scopes";

/**
 * Invite one or several colleagues. Owners can also invite Admins and choose their scopes.
 * When the email cannot be sent, the invitation link can be copied and shared by hand.
 */
export function InviteForm({
  canInviteAdmins,
  compact = false,
  footer,
}: {
  canInviteAdmins: boolean;
  compact?: boolean;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("members");
  const tErrors = useTranslations("errors");
  const tScopes = useTranslations("scopes");
  const [state, action] = useActionState(inviteMembersAction, null);
  const [role, setRole] = useState<"member" | "admin">("member");

  const outcomes = state?.ok ? (state.data ?? []) : [];

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-5">
        <Field label={t("emailsLabel")} htmlFor="emails" hint={t("emailsHint")} error={state && !state.ok ? tErrors(state.error) : undefined}>
          <Textarea id="emails" name="emails" rows={compact ? 3 : 2} required placeholder={t("emailsPlaceholder")} />
        </Field>
        {!compact ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t("jobTitle")} htmlFor="jobTitle">
              <Input id="jobTitle" name="jobTitle" maxLength={120} placeholder={t("jobTitlePlaceholder")} />
            </Field>
            <Field label={t("expertise")} htmlFor="expertise" hint={t("expertiseHint")}>
              <Input id="expertise" name="expertise" placeholder={t("expertisePlaceholder")} />
            </Field>
          </div>
        ) : null}
        {canInviteAdmins && !compact ? (
          <div className="space-y-4">
            <Field label={t("role")} htmlFor="role">
              <Select name="role" value={role} onValueChange={(v) => setRole(v as "member" | "admin")}>
                <SelectTrigger id="role" className="sm:w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t("roleMember")}</SelectItem>
                  <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {role === "admin" ? (
              <fieldset className="space-y-2 rounded-lg border p-4">
                <legend className="px-1 text-[13px] font-medium">{t("scopesLegend")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ADMIN_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-center gap-2 text-sm">
                      <Checkbox name="scopes" value={scope} />
                      <span>{tScopes(scope)}</span>
                      {!AVAILABLE_SCOPES.includes(scope) ? (
                        <span className="text-xs text-muted-foreground">{t("scopeLater")}</span>
                      ) : null}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <div>{footer}</div>
          <SubmitButton>
            <MailIcon />
            {t("sendInvitations")}
          </SubmitButton>
        </div>
      </form>

      {outcomes.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {outcomes.map((o) => (
            <li key={o.email} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              {o.ok ? <CheckIcon className="size-4 text-success" /> : <TriangleAlertIcon className="size-4 text-destructive" />}
              <span className="min-w-0 flex-1 truncate font-medium">{o.email}</span>
              {o.ok ? (
                <>
                  <span className="text-xs text-muted-foreground">{o.emailSent ? t("emailSent") : t("emailNotSent")}</span>
                  {o.link ? <CopyLinkButton link={o.link} /> : null}
                </>
              ) : (
                <span className="text-xs text-destructive">{tErrors(o.error ?? "unknown")}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CopyLinkButton({ link }: { link: string }) {
  const t = useTranslations("members");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? t("linkCopied") : t("copyLink")}
    </Button>
  );
}
