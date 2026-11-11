"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBrowserSupabase } from "@/lib/supabase/client";

type Supabase = ReturnType<typeof createBrowserSupabase>;
type Enrolment = { factorId: string; qrCode: string; secret: string };

/** A 6-digit code field (digits only, one-time-code autofill on phones). */
function CodeField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const t = useTranslations("twoStep");
  return (
    <div className="space-y-1.5">
      <Label htmlFor="two-step-code">{t("codeLabel")}</Label>
      <Input
        id="two-step-code"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        placeholder="123456"
        className="text-center font-mono text-lg tracking-[0.4em]"
      />
    </div>
  );
}

async function verify(supabase: Supabase, factorId: string, code: string): Promise<"ok" | "invalid" | "error"> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (!error) return "ok";
  return error.code === "mfa_verification_failed" || /invalid|expired/i.test(error.message) ? "invalid" : "error";
}

/** Asks for the authenticator's code, then opens the app (or our console). */
export function TwoStepChallenge() {
  const t = useTranslations("twoStep");
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<"invalid" | "error" | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp[0];
    const result = factor ? await verify(supabase, factor.id, code) : "error";
    if (result === "ok") {
      router.replace("/");
      router.refresh();
      return;
    }
    setError(result);
    setPending(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <CodeField value={code} onChange={setCode} autoFocus />
      {error ? <p className="text-sm text-destructive">{t(error)}</p> : null}
      <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
        {t("verify")}
      </Button>
    </form>
  );
}

/**
 * Sets up an authenticator: a QR code to scan (or the key to type), then one code to confirm it.
 * Unfinished attempts are cleared first, so starting again never piles up factors.
 */
export function TwoStepSetup({ onDone }: { onDone: () => void }) {
  const t = useTranslations("twoStep");
  const [enrolment, setEnrolment] = React.useState<Enrolment | null>(null);
  const [code, setCode] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<"invalid" | "error" | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserSupabase();
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: enrolError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Cendr ${new Date().toISOString().slice(0, 10)}` });
      if (cancelled) return;
      if (enrolError || !data) setError("error");
      else setEnrolment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolment) return;
    setPending(true);
    setError(null);
    const result = await verify(createBrowserSupabase(), enrolment.factorId, code);
    if (result === "ok") onDone();
    else {
      setError(result);
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex justify-center">
        {enrolment ? (
          // The QR code comes from Supabase as an SVG data address (no outside request).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={enrolment.qrCode} alt={t("qrAlt")} width={176} height={176} className="rounded-xl bg-white p-2" data-testid="two-step-qr" />
        ) : (
          <div className="size-44 animate-pulse rounded-xl bg-muted" aria-busy />
        )}
      </div>
      {enrolment ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t("secretLabel")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/40 px-2.5 py-1.5 font-mono text-[13px]" data-testid="two-step-secret">
              {enrolment.secret}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("copy")}
              onClick={() => {
                void navigator.clipboard?.writeText(enrolment.secret);
                setCopied(true);
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </div>
      ) : null}
      <CodeField value={code} onChange={setCode} />
      {error ? <p className="text-sm text-destructive">{t(error)}</p> : null}
      <Button type="submit" className="w-full" disabled={!enrolment || pending || code.length !== 6}>
        {t("activate")}
      </Button>
    </form>
  );
}

/** Profile card: whether two-step sign-in is on, to turn it on (or off, unless it is required). */
export function TwoStepCard({ enabled, required }: { enabled: boolean; required: boolean }) {
  const t = useTranslations("twoStep");
  const router = useRouter();
  const [setting, setSetting] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const disable = async () => {
    setPending(true);
    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all ?? []) {
      if (f.factor_type === "totp") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    setPending(false);
    toast.success(t("disabled"));
    router.refresh();
  };

  return (
    <section aria-labelledby="two-step-title" className="glass-standard mt-6 space-y-4 rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id="two-step-title" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <ShieldCheckIcon className="size-4" />
            {t("cardTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("cardBody")}</p>
          {required ? <p className="text-xs text-muted-foreground">{t("requiredNote")}</p> : null}
        </div>
        <span className={enabled ? "shrink-0 text-xs font-medium text-success" : "shrink-0 text-xs text-muted-foreground"}>{enabled ? t("on") : t("off")}</span>
      </div>
      {setting ? (
        <TwoStepSetup
          onDone={() => {
            setSetting(false);
            toast.success(t("enabled"));
            router.refresh();
          }}
        />
      ) : enabled ? (
        required ? null : (
          <Button variant="outline" size="sm" onClick={disable} disabled={pending}>
            {t("disable")}
          </Button>
        )
      ) : (
        <Button size="sm" onClick={() => setSetting(true)}>
          {t("enable")}
        </Button>
      )}
    </section>
  );
}

/** Setting it up right after sign-in (our team): once confirmed, the console opens. */
export function TwoStepSetupScreen() {
  const router = useRouter();
  return (
    <TwoStepSetup
      onDone={() => {
        router.replace("/");
        router.refresh();
      }}
    />
  );
}
