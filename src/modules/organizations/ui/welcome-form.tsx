"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRightIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { updateMyProfile } from "@/modules/identity/server/actions";
import { updateMyCardAction } from "../server/actions";
import type { ActionResult } from "@/lib/errors";

export function WelcomeForm({
  companyName,
  fullName,
  jobTitle,
  expertise,
}: {
  companyName: string;
  fullName: string | null;
  jobTitle: string;
  expertise: string;
}) {
  const t = useTranslations("onboarding");
  const tProfile = useTranslations("profile");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [state, action] = useActionState(async (_: ActionResult | null, formData: FormData): Promise<ActionResult> => {
    const profile = await updateMyProfile(null, formData);
    if (!profile.ok) return profile;
    const card = await updateMyCardAction(null, formData);
    if (!card.ok) return card;
    router.push("/");
    return { ok: true };
  }, null);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="w-full max-w-lg space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("welcomeTitle", { company: companyName })}</h1>
        <p className="text-sm text-muted-foreground">{t("welcomeSubtitle")}</p>
      </div>
      <form action={action} className="space-y-5">
        <Field label={t("yourName")} htmlFor="fullName">
          <Input id="fullName" name="fullName" defaultValue={fullName ?? ""} required maxLength={120} autoComplete="name" />
        </Field>
        <Field label={tProfile("jobTitle")} htmlFor="jobTitle">
          <Input id="jobTitle" name="jobTitle" defaultValue={jobTitle} maxLength={120} placeholder={tProfile("jobTitlePlaceholder")} />
        </Field>
        <Field label={tProfile("expertise")} htmlFor="expertise" hint={tProfile("expertiseHint")}>
          <Input id="expertise" name="expertise" defaultValue={expertise} placeholder={tProfile("expertisePlaceholder")} />
        </Field>
        {state && !state.ok ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
        <SubmitButton className="w-full" size="lg">
          {t("continue")}
          <ArrowRightIcon />
        </SubmitButton>
      </form>
    </motion.div>
  );
}
