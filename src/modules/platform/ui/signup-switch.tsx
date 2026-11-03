"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setOpenSignupAction } from "../server/app-actions";

/** Who may create a company: only those our team invites (launch), or anyone signed in. */
export function SignupSwitch({ open }: { open: boolean }) {
  const t = useTranslations("platform");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3">
      <span>
        <span className="block text-sm font-medium">{t("openSignup")}</span>
        <span className="block text-[13px] text-muted-foreground">{open ? t("openSignupOn") : t("openSignupOff")}</span>
      </span>
      <Switch
        checked={open}
        disabled={pending}
        aria-label={t("openSignup")}
        onCheckedChange={(next) =>
          start(async () => {
            const result = await setOpenSignupAction(next);
            if (!result.ok) toast.error(tErrors(result.error));
            else router.refresh();
          })
        }
      />
    </label>
  );
}
