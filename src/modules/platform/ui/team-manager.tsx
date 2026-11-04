"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { toast } from "sonner";
import { MailIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/form";
import { addPlatformAdminAction, removePlatformAdminAction } from "../server/app-actions";

export type TeamMember = { userId: string; email: string; name: string | null; addedAt: string; inCompany: boolean; me: boolean };

/** Plateforme → Équipe: who has our console, invitations waiting for a first sign-in, and adding someone. */
export function TeamManager({ members, invites, appUrl }: { members: TeamMember[]; invites: { email: string; createdAt: string }[]; appUrl: string }) {
  const t = useTranslations("platformTeam");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [pending, start] = React.useTransition();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  const add = () =>
    start(async () => {
      const result = await addPlatformAdminAction({ email });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(result.data?.outcome === "added" ? t("added", { email }) : t("invited", { email }));
      setEmail("");
      router.refresh();
    });
  const remove = (input: { userId?: string; email?: string }) =>
    start(async () => {
      const result = await removePlatformAdminAction(input);
      if (!result.ok) toast.error(tErrors(result.error));
      else router.refresh();
    });

  return (
    <div className="space-y-8">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) add();
        }}
      >
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} aria-label={t("emailLabel")} required className="h-10 sm:flex-1" />
        <Button type="submit" disabled={pending} className="h-10">
          {pending ? <Spinner /> : <UserPlusIcon />}
          {t("add")}
        </Button>
      </form>
      <p className="-mt-6 text-[13px] text-muted-foreground">{t("howItWorks", { url: `${appUrl}/login` })}</p>

      <section aria-labelledby="members" className="space-y-3">
        <h2 id="members" className="text-[13px] font-medium text-muted-foreground">
          {t("members", { count: members.length })}
        </h2>
        <Card className="divide-y p-0">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-3" data-testid="team-member">
              <Avatar name={m.name ?? m.email} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name ?? m.email}
                  {m.me ? <span className="ml-2 text-xs font-normal text-muted-foreground">{t("you")}</span> : null}
                </p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {m.email} · {t("since", { date: date(m.addedAt) })}
                </p>
              </div>
              {m.inCompany ? <Badge variant="warning" title={t("inCompanyHint")}>{t("inCompany")}</Badge> : null}
              {m.me || members.length <= 1 ? null : (
                <Button variant="ghost" size="icon-sm" aria-label={t("remove", { name: m.name ?? m.email })} disabled={pending} onClick={() => remove({ userId: m.userId })}>
                  <Trash2Icon />
                </Button>
              )}
            </div>
          ))}
        </Card>
      </section>

      {invites.length > 0 ? (
        <section aria-labelledby="invites" className="space-y-3">
          <h2 id="invites" className="text-[13px] font-medium text-muted-foreground">
            {t("waiting")}
          </h2>
          <Card className="divide-y p-0">
            {invites.map((i) => (
              <div key={i.email} className="flex items-center gap-3 px-4 py-3" data-testid="team-invite">
                <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MailIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-[13px] text-muted-foreground">{t("waitingSince", { date: date(i.createdAt) })}</p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t("cancel", { email: i.email })} disabled={pending} onClick={() => remove({ email: i.email })}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}
