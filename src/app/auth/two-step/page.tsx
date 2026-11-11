import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ShieldCheckIcon } from "lucide-react";
import { getAppContext } from "@/lib/auth/context";
import { Button } from "@/components/ui/button";
import AuthLayout from "@/app/(auth)/layout";
import { TwoStepChallenge, TwoStepSetupScreen } from "@/modules/identity/ui/two-step";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("twoStep");
  return { title: t("challengeTitle") };
}

/**
 * Second step of sign-in: the authenticator's code (or, for our team, setting one up). Every other page
 * sends here until this session has passed it (src/lib/auth/guards.ts); the database refuses the rest.
 */
export default async function TwoStepPage() {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  if (!ctx.twoStep) redirect("/");
  const t = await getTranslations("twoStep");
  const setup = ctx.twoStep === "setup";
  return (
    <AuthLayout>
      <div className="glass-elevated w-full max-w-sm space-y-6 rounded-[28px] border px-8 py-10">
        <div className="space-y-2 text-center">
          <div className="glass-standard mx-auto flex size-12 items-center justify-center rounded-full border text-muted-foreground">
            <ShieldCheckIcon className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{setup ? t("setupTitle") : t("challengeTitle")}</h1>
          <p className="text-sm text-muted-foreground">{setup ? t("setupBody") : t("challengeBody")}</p>
        </div>
        {setup ? <TwoStepSetupScreen /> : <TwoStepChallenge />}
        <form action="/auth/signout" method="post" className="text-center">
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
            {t("signOut")}
          </Button>
        </form>
        <p className="text-center text-xs text-muted-foreground">{t("lostDevice")}</p>
      </div>
    </AuthLayout>
  );
}
