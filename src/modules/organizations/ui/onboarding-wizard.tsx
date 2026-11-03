"use client";

import { useActionState, useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRightIcon, CheckIcon, FileTextIcon, UsersIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { ComingSoon } from "@/components/ui/coming-soon";
import { DocumentUploader } from "@/modules/memory/ui/document-uploader";
import { ClientForm } from "@/modules/clients/ui/client-form";
import { acceptInvitationAction, completeOnboardingAction, createCompanyAction } from "../server/actions";
import { CompanyProfileForm, type CompanyProfileValues } from "./company-profile-form";
import { InviteForm } from "./invite-form";
import { AvatarStudio } from "@/modules/avatars/ui/avatar-studio";
import { cn } from "@/lib/utils";
import type { ErrorCode } from "@/lib/errors";

export type OnboardingStep = "start" | "avatar" | "company" | SetupStep;
/** Set up later from the home page's checklist (CLAUDE.md §11): each one returns to the home page. */
export type SetupStep = "invite" | "client" | "document";
export const SETUP_STEPS: SetupStep[] = ["invite", "client", "document"];

/** The onboarding itself: the name, the company and the avatar, then straight to the first conversation. */
const PROGRESS: OnboardingStep[] = ["start", "avatar", "company"];

type Props = {
  step: OnboardingStep;
  fullName: string | null;
  email: string;
  invitations?: { id: string; companyName: string; invitedBy: string | null }[];
  /** Our team opened sign-up: anyone signed in may create their own company. */
  signupOpen?: boolean;
  company?: CompanyProfileValues | null;
  members?: { userId: string; name: string }[];
  /** Company memory, where the first document goes. */
  companySpaceId?: string | null;
  /** The avatar step: the person's current avatar, the credit cost, test mode. */
  avatar?: { currentUrl: string | null; credits: number; testMode: boolean };
};

export function OnboardingWizard(props: Props) {
  const t = useTranslations("onboarding");
  const tAvatar = useTranslations("avatar");
  const router = useRouter();
  const go = useCallback((step: OnboardingStep) => router.push(`/onboarding?step=${step}`), [router]);
  const home = useCallback(() => router.push("/"), [router]);
  const [finishing, startFinishing] = useTransition();
  // The last onboarding step: the company is set up, the person goes straight to the first conversation.
  const finish = () =>
    startFinishing(async () => {
      const form = new FormData();
      form.set("next", "/chat");
      await completeOnboardingAction(form);
    });

  return (
    <div className="w-full max-w-lg">
      {PROGRESS.includes(props.step) ? <Progress current={props.step} /> : null}
      <motion.div
        key={props.step}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="mt-10"
      >
        {props.step === "start" ? <StartStep {...props} /> : null}

        {props.step === "avatar" && props.avatar ? (
          <StepFrame title={tAvatar("onboardingTitle")} subtitle={tAvatar("onboardingSubtitle")}>
            <AvatarStudio
              name={props.fullName ?? props.email}
              currentUrl={props.avatar.currentUrl}
              credits={props.avatar.credits}
              testMode={props.avatar.testMode}
              // A short beat to see it, then on to the next step.
              onDone={(url) => url && setTimeout(() => go("company"), 900)}
              className="pt-2"
            />
            <div className="mt-8 flex justify-end">
              <Button type="button" variant="ghost" onClick={() => go("company")}>
                {tAvatar("later")}
                <ArrowRightIcon />
              </Button>
            </div>
          </StepFrame>
        ) : null}

        {props.step === "company" && props.company ? (
          <StepFrame title={t("companyTitle")} subtitle={t("companySubtitle")}>
            <CompanyProfileForm
              initial={props.company}
              submitLabel={t("continue")}
              onSaved={finish}
              secondary={
                <Button type="button" variant="ghost" disabled={finishing} onClick={finish}>
                  {t("skip")}
                </Button>
              }
            />
          </StepFrame>
        ) : null}

        {props.step === "invite" ? (
          <StepFrame title={t("inviteTitle")} subtitle={t("inviteSubtitle")}>
            <InviteForm canInviteAdmins={false} compact footer={null} />
            <div className="mt-8 flex justify-end">
              <Button onClick={home}>
                {t("continue")}
                <ArrowRightIcon />
              </Button>
            </div>
          </StepFrame>
        ) : null}

        {props.step === "client" ? (
          <StepFrame title={t("clientTitle")} subtitle={t("clientSubtitle")}>
            <ClientForm
              members={props.members ?? []}
              submitLabel={t("createClient")}
              onCreated={home}
              secondary={
                <Button type="button" variant="ghost" onClick={home}>
                  {t("later")}
                </Button>
              }
            />
          </StepFrame>
        ) : null}

        {props.step === "document" ? (
          <StepFrame title={t("documentTitle")} subtitle={t("documentSubtitle")}>
            <FirstDocument spaceId={props.companySpaceId ?? null} />
            <div className="mt-8 flex justify-end gap-2">
              <Button onClick={home}>
                {t("continue")}
                <ArrowRightIcon />
              </Button>
            </div>
          </StepFrame>
        ) : null}

      </motion.div>
    </div>
  );
}

function StartStep({ fullName, email, invitations = [], signupOpen = false }: Props) {
  const t = useTranslations("onboarding");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [state, action] = useActionState(createCompanyAction, null);
  const [joining, startJoining] = useTransition();
  const [joinError, setJoinError] = useState<ErrorCode | null>(null);

  return (
    <div className="space-y-10">
      {invitations.length > 0 ? (
        <section className="space-y-3">
          <StepHeading title={t("invitedTitle")} subtitle={t("invitedSubtitle")} />
          <ul className="space-y-2">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 rounded-xl border bg-card p-4">
                <div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <UsersIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.companyName}</p>
                  {inv.invitedBy ? (
                    <p className="truncate text-xs text-muted-foreground">{t("invitedBy", { name: inv.invitedBy })}</p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="brand"
                  disabled={joining}
                  onClick={() =>
                    startJoining(async () => {
                      const result = await acceptInvitationAction({ invitationId: inv.id });
                      if (result.ok) router.push("/onboarding/welcome");
                      else setJoinError(result.error);
                    })
                  }
                >
                  {t("join")}
                </Button>
              </li>
            ))}
          </ul>
          {joinError ? <FormMessage>{tErrors(joinError)}</FormMessage> : null}
        </section>
      ) : null}

      {!signupOpen ? (
        invitations.length === 0 ? (
          <section className="space-y-3" data-testid="invite-only">
            <StepHeading title={t("inviteOnlyTitle")} subtitle={t("inviteOnlyBody", { email })} />
          </section>
        ) : null
      ) : (
      <section className="space-y-6">
        <StepHeading
          title={invitations.length > 0 ? t("orCreateTitle") : t("startTitle")}
          subtitle={t("startSubtitle", { email })}
        />
        <form action={action} className="space-y-5">
          <Field label={t("yourName")} htmlFor="fullName" error={state && !state.ok && state.fields?.fullName ? t("required") : undefined}>
            <Input id="fullName" name="fullName" defaultValue={fullName ?? ""} required maxLength={120} autoComplete="name" placeholder={t("yourNamePlaceholder")} />
          </Field>
          <Field label={t("companyName")} htmlFor="companyName" error={state && !state.ok && state.fields?.companyName ? t("required") : undefined}>
            <Input id="companyName" name="companyName" required maxLength={120} autoComplete="organization" placeholder={t("companyNamePlaceholder")} />
          </Field>
          {state && !state.ok && state.error !== "validation" ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
          <SubmitButton className="w-full" size="lg">
            {t("createCompany")}
            <ArrowRightIcon />
          </SubmitButton>
        </form>
      </section>
      )}
    </div>
  );
}

function Progress({ current }: { current: OnboardingStep }) {
  const t = useTranslations("onboarding.steps");
  const index = PROGRESS.indexOf(current);
  return (
    <ol className="flex items-center gap-1.5" aria-label={t("label")}>
      {PROGRESS.map((step, i) => (
        <li key={step} className="flex-1">
          <div
            className={cn(
              "h-1 rounded-full transition-colors duration-300",
              i < index ? "bg-brand" : i === index ? "bg-brand/60" : "bg-border",
            )}
          />
          <span className={cn("mt-2 hidden text-[11px] sm:flex sm:items-center sm:gap-1", i <= index ? "text-foreground" : "text-muted-foreground")}>
            {i < index ? <CheckIcon className="size-3 text-brand" /> : null}
            {t(step)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

function StepFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-8">
      <StepHeading title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}

function FirstDocument({ spaceId }: { spaceId: string | null }) {
  const t = useTranslations("onboarding");
  const [added, setAdded] = useState(false);
  if (!spaceId) return <SoonCard icon={<FileTextIcon />} text={t("documentUnavailable")} />;
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      <p>{t("documentBody")}</p>
      <DocumentUploader spaceId={spaceId} onUploaded={() => setAdded(true)} />
      {added ? <p className="text-success">{t("documentAdded")}</p> : null}
    </div>
  );
}

function SoonCard({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-dashed p-5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">{icon}</div>
      <div className="space-y-2">
        <ComingSoon />
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
