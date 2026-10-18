"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { MailIcon } from "lucide-react";
import { motion } from "motion/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { sendMagicLink, signInWithGoogle } from "../server/actions";

type LoginFormProps = {
  next: string;
  googleEnabled: boolean;
  linkError: "linkInvalid" | "oauthFailed" | null;
  showLocalMailHint: boolean;
};

/** Remounting the flow (new key) resets it when the user wants to use another address. */
export function LoginForm(props: LoginFormProps) {
  const [attempt, setAttempt] = useState(0);
  return <LoginFlow key={attempt} {...props} onReset={() => setAttempt((n) => n + 1)} />;
}

function LoginFlow({ next, googleEnabled, linkError, showLocalMailHint, onReset }: LoginFormProps & { onReset: () => void }) {
  const t = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const [state, action] = useActionState(sendMagicLink, null);
  const sentTo = state?.ok ? state.data?.email : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full max-w-sm"
    >
      {sentTo ? (
        <div className="space-y-6 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
            <MailIcon className="size-5" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">{t("checkInboxTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("checkInboxBody", { email: sentTo })}</p>
          </div>
          {showLocalMailHint ? <p className="text-xs text-muted-foreground">{t("localMailHint")}</p> : null}
          <Button variant="ghost" onClick={onReset}>
            {t("useAnotherEmail")}
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t("signInTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("signInSubtitle")}</p>
          </div>

          {linkError ? <FormMessage>{t(linkError)}</FormMessage> : null}

          <form action={action} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <Field
              label={t("emailLabel")}
              htmlFor="email"
              error={state && !state.ok ? tErrors(state.error) : undefined}
            >
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
                placeholder={t("emailPlaceholder")}
                className="h-10"
              />
            </Field>
            <SubmitButton className="h-10 w-full">{t("continueWithEmail")}</SubmitButton>
          </form>

          {googleEnabled ? (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("or")}
                <span className="h-px flex-1 bg-border" />
              </div>
              <form action={signInWithGoogle}>
                <input type="hidden" name="next" value={next} />
                <SubmitButton variant="outline" className="h-10 w-full">
                  <GoogleMark />
                  {t("continueWithGoogle")}
                </SubmitButton>
              </form>
            </>
          ) : null}

          <p className="text-xs leading-relaxed text-muted-foreground">{t("noPassword")}</p>
        </div>
      )}
    </motion.div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.73Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.27a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.27 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}
