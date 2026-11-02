"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckIcon, MonitorCheckIcon, RocketIcon, SendIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { acceptFixAction, createFixRequestAction, launchReleaseAction, rejectFixAction, runCheckAction, type ReleaseActionError } from "../server/release-actions";

function useErrorText() {
  const t = useTranslations("platformReleases");
  return (error: ReleaseActionError) => t(`errors.${error}` as "errors.unknown");
}

/** While something runs on GitHub, the page refreshes itself every 15 seconds. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}

/** "Lancer la v1.4": notes, then a confirmation saying what happens for every company. */
export function ReleaseLauncher({ next, disabledReason }: { next: string; disabledReason: string | null }) {
  const t = useTranslations("platformReleases");
  const errorText = useErrorText();
  const router = useRouter();
  const [notes, setNotes] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [pending, start] = React.useTransition();
  return (
    <div className="space-y-3">
      <label className="grid gap-1.5 text-sm">
        <span className="text-[13px] text-muted-foreground">{t("notesLabel")}</span>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} placeholder={t("notesPlaceholder")} disabled={Boolean(disabledReason)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setConfirming(true)} disabled={Boolean(disabledReason) || pending}>
          <RocketIcon />
          {t("launch", { version: next })}
        </Button>
        {disabledReason ? <span className="text-[13px] text-muted-foreground">{disabledReason}</span> : null}
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle", { version: next })}</DialogTitle>
            <DialogDescription>{t("confirmBody", { version: next })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await launchReleaseAction({ notes });
                  setConfirming(false);
                  if (!result.ok) return void toast.error(errorText(result.error));
                  toast.success(t("launched", { version: result.version }));
                  setNotes("");
                  router.refresh();
                })
              }
            >
              {pending ? <Spinner /> : <RocketIcon />}
              {t("confirmLaunch", { version: next })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CheckNowButton({ disabledReason }: { disabledReason: string | null }) {
  const t = useTranslations("platformReleases");
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        disabled={Boolean(disabledReason) || pending}
        onClick={() =>
          start(async () => {
            const result = await runCheckAction();
            if (!result.ok) return void toast.error(errorText(result.error));
            toast.success(t("checkStarted"));
            router.refresh();
          })
        }
      >
        {pending ? <Spinner /> : <MonitorCheckIcon />}
        {t("checkNow")}
      </Button>
      {disabledReason ? <span className="text-[13px] text-muted-foreground">{disabledReason}</span> : null}
    </div>
  );
}

export function FixRequestForm({ disabledReason }: { disabledReason: string | null }) {
  const t = useTranslations("platformReleases");
  const errorText = useErrorText();
  const router = useRouter();
  const [request, setRequest] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await createFixRequestAction({ request });
          if (!result.ok) return void toast.error(errorText(result.error));
          toast.success(t("fixSent"));
          setRequest("");
          router.refresh();
        });
      }}
    >
      <Textarea
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder={t("fixPlaceholder")}
        aria-label={t("fixLabel")}
        disabled={Boolean(disabledReason)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={Boolean(disabledReason) || pending || request.trim().length < 5}>
          {pending ? <Spinner /> : <SendIcon />}
          {t("fixSend")}
        </Button>
        {disabledReason ? <span className="text-[13px] text-muted-foreground">{disabledReason}</span> : null}
      </div>
    </form>
  );
}

export function FixDecision({ requestId, canAccept = true }: { requestId: string; canAccept?: boolean }) {
  const t = useTranslations("platformReleases");
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const decide = (accept: boolean) =>
    start(async () => {
      const result = accept ? await acceptFixAction({ requestId }) : await rejectFixAction({ requestId });
      if (!result.ok) return void toast.error(errorText(result.error));
      toast.success(accept ? t("fixAccepted") : t("fixRejected"));
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      {canAccept ? (
        <Button size="sm" disabled={pending} onClick={() => decide(true)}>
          {pending ? <Spinner /> : <CheckIcon />}
          {t("accept")}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(false)}>
        <XIcon />
        {t("reject")}
      </Button>
    </div>
  );
}
