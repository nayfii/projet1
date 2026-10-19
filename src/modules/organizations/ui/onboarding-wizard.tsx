"use client";

import { useActionState, useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRightIcon, CheckIcon, FileTextIcon, MessageSquareIcon, UsersIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { ComingSoon } from "@/components/ui/coming-soon";
import { DocumentUploader } from "@/modules/memory/ui/document-uploader";
import { ClientForm } from "@/modules/clients/ui/client-form";
import { acceptInvitationAction, completeOnboardingAction, createCompanyAction } from "../server/actions";
import { CompanyProfileForm, type CompanyProfileValues } from "./company-profile-form";
import { InviteForm } from "./invite-form";
import { cn } from "@/lib/utils";
import type { ErrorCode } from "@/lib/errors";

export type OnboardingStep = "start" | "company" | "invite" | "client" | "document" | "conversation";

const PROGRESS: OnboardingStep[] = ["start", "company", "invite", "client", "document", "conversation"];

type Props = {
  step: OnboardingStep;
  fullName: string | null;
  email: string;
  invitations?: { id: string; companyName: string; invitedBy: string | null }[];
  company?: CompanyProfileValues | null;
  members?: { userId: string; name: string }[];
  /** Company memory, where the first document goes. */
  companySpaceId?: string | null;
};

export function OnboardingWizard(props: Props) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const go = useCallback((step: OnboardingStep) => router.push(`/onboarding?step=${step}`), [router]);
  const skip = (step: OnboardingStep) => (
    <Button type="button" variant="ghost" onClick={() => go(step)}>
      {t("skip")}
    </Button>
  );

  return (
    <div className="w-full max-w-lg">
      <Progress current={props.step} />
      <motion.div
        key={props.step}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="mt-10"
      >
        {props.step === "start" ? <StartStep {...props} /> : null}

        {props.step === "company" && props.company ? (
          <StepFrame title={t("companyTitle")} subtitle={t("companySubtitle")}>
            <CompanyProfileForm
              initial={props.company}
              submitLabel={t("continue")}
              onSaved={() => go("invite")}
              secondary={skip("invite")}
            />
          </StepFrame>
        ) : null}

        {props.step === "invite" ? (
          <StepFrame title={t("inviteTitle")} subtitle={t("inviteSubtitle")}>
            <InviteForm canInviteAdmins={false} compact footer={null} />
            <div className="mt-8 flex justify-end">
              <Button onClick={() => go("client")}>
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
              onCreated={() => go("document")}
              secondary={skip("document")}
            />
          </StepFrame>
        ) : null}

        {props.step === "document" ? (
          <StepFrame title={t("documentTitle")} subtitle={t("documentSubtitle")}>
            <FirstDocument spaceId={props.companySpaceId ?? null} />
            <div className="mt-8 flex justify-end gap-2">
              {skip("conversation")}
              <Button onClick={() => go("conversation")}>
                {t("continue")}
                <ArrowRightIcon />
              </Button>
            </div>
          </StepFrame>
        ) : null}

        {props.step === "conversation" ? (
          <StepFrame title={t("conversationTitle")} subtitle={t("conversationSubtitle")}>
            <div className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
              <MessageSquareIcon className="mt-0.5 size-4 shrink-0" />
              <p>{t("conversationBody")}</p>
            </div>
            <div className="mt-8 flex flex-wrap justify-end gap-2">
              <form action={completeOnboardingAction}>
                <SubmitButton variant="ghost">{t("finish")}</SubmitButton>
              </form>
              <form action={completeOnboardingAction}>
                <input type="hidden" name="next" value="/chat" />
                <SubmitButton variant="brand">
                  {t("startConversation")}
                  <ArrowRightIcon />
                </SubmitButton>
              </form>
            </div>
          </StepFrame>
        ) : null}
      </motion.div>
    </div>
  );
}

function StartStep({ fullName, email, invitations = [] }: Props) {
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
