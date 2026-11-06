"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { LockIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestClientAccessAction } from "../server/consciousness-actions";

/**
 * A link to a client someone cannot open: one click asks for access. The page says nothing about
 * the client (not even whether it exists); the right approver is found by the server.
 */
export function RequestAccess({ clientId }: { clientId: string }) {
  const t = useTranslations("consciousness.access");
  const tErrors = useTranslations("errors");
  const [reason, setReason] = React.useState("");
  const [days, setDays] = React.useState<number | null>(30);
  const [sent, setSent] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <Card className="mx-auto mt-10 max-w-md space-y-4 p-6" data-testid="request-access">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted">
        <LockIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{sent ? t("sentBody") : t("body")}</p>
      </div>
      {sent ? null : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await requestClientAccessAction({ clientId, reason: reason.trim() || undefined, days });
              if (!result.ok) return void toast.error(tErrors(result.error));
              setSent(true);
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="access-reason">{t("reason")}</Label>
            <Input id="access-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("duration")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {[7, 30, null].map((d) => (
                <Button key={String(d)} type="button" size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
                  {d ? t("days", { count: d }) : t("noEnd")}
                </Button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={pending} className="w-full gap-1.5">
            <SendIcon />
            {t("request")}
          </Button>
        </form>
      )}
    </Card>
  );
}
