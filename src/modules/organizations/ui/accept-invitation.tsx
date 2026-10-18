"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage, Spinner } from "@/components/ui/form";
import type { ErrorCode } from "@/lib/errors";
import { acceptInvitationAction } from "../server/actions";

export function AcceptInvitation({ token, email }: { token: string; email: string }) {
  const t = useTranslations("invite");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorCode | null>(null);

  return (
    <div className="w-full max-w-sm space-y-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <UsersIcon className="size-5" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("signedInAs", { email })}</p>
      </div>
      {error ? <FormMessage>{tErrors(error)}</FormMessage> : null}
      <div className="flex flex-col gap-2">
        <Button
          variant="brand"
          size="lg"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await acceptInvitationAction({ token });
              if (result.ok) router.push("/onboarding/welcome");
              else setError(result.error);
            })
          }
        >
          {pending ? <Spinner /> : null}
          {t("accept")}
        </Button>
        {error === "invitation_wrong_email" ? (
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" className="w-full">
              {t("switchAccount")}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
