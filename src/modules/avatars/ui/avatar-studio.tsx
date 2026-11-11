"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CameraIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComingSoon } from "@/components/ui/coming-soon";
import { cn, initials } from "@/lib/utils";
import { AVATAR_ERRORS, type AvatarError } from "../files";
import { chooseAvatarAction, discardAvatarAction, removeAvatarAction } from "../server/actions";

type Phase = { kind: "idle" } | { kind: "generating"; photoUrl: string } | { kind: "ready"; previewUrl: string; test: boolean } | { kind: "saving"; previewUrl: string };

/**
 * "Import a photo → watch it become your avatar → keep it." One component for the profile page and
 * the onboarding. The photo is squared and re-encoded in the browser first (which also drops its
 * EXIF data, location included), then sent once; only the result is stored.
 */
export function AvatarStudio({
  name,
  currentUrl,
  credits,
  testMode,
  size = 168,
  onDone,
  className,
}: {
  name: string;
  currentUrl: string | null;
  credits: number;
  testMode: boolean;
  size?: number;
  /** Called after the person keeps an avatar (its URL) or goes back to initials (null). */
  onDone?: (avatarUrl: string | null) => void;
  className?: string;
}) {
  const t = useTranslations("avatar");
  const format = useFormatter();
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const lastPhoto = React.useRef<Blob | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [current, setCurrent] = React.useState(currentUrl);
  const [error, setError] = React.useState<AvatarError | null>(null);
  const [removing, startRemoving] = React.useTransition();

  async function generate(photo: Blob) {
    lastPhoto.current = photo;
    setError(null);
    const photoUrl = URL.createObjectURL(photo);
    setPhase({ kind: "generating", photoUrl });
    try {
      const body = new FormData();
      body.append("photo", photo, "photo.jpg");
      const res = await fetch("/api/avatars/generate", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { ok: true; previewUrl: string; test: boolean } | { ok: false; error: string } | null;
      if (!json || !json.ok) {
        const code = json && !json.ok && (AVATAR_ERRORS as readonly string[]).includes(json.error) ? (json.error as AvatarError) : "failed";
        setError(code);
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "ready", previewUrl: json.previewUrl, test: json.test });
    } catch {
      setError("failed");
      setPhase({ kind: "idle" });
    } finally {
      URL.revokeObjectURL(photoUrl);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const photo = await squarePhoto(file).catch(() => null);
    if (!photo) return setError("invalid_photo");
    await generate(photo);
  }

  async function keep() {
    if (phase.kind !== "ready") return;
    setPhase({ kind: "saving", previewUrl: phase.previewUrl });
    const result = await chooseAvatarAction();
    if (!result.ok || !result.data) {
      setError("failed");
      setPhase({ kind: "ready", previewUrl: phase.previewUrl, test: false });
      return;
    }
    setCurrent(result.data.avatarUrl);
    setPhase({ kind: "idle" });
    toast.success(t("saved"));
    router.refresh();
    onDone?.(result.data.avatarUrl);
  }

  async function discard() {
    setPhase({ kind: "idle" });
    await discardAvatarAction();
  }

  const busy = phase.kind === "generating" || phase.kind === "saving";
  const shown = phase.kind === "ready" || phase.kind === "saving" ? phase.previewUrl : current;

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        {phase.kind === "generating" ? (
          <>
            <span aria-hidden className="avatar-studio-ring absolute -inset-[6px] rounded-full" />
            <span className="absolute inset-0 overflow-hidden rounded-full bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the photo being transformed */}
              <img src={phase.photoUrl} alt="" className="avatar-studio-photo size-full object-cover" />
            </span>
          </>
        ) : shown ? (
          <>
            {phase.kind === "ready" ? <span aria-hidden className="avatar-studio-burst absolute -inset-[30%] rounded-full" /> : null}
            {/* The cut-out avatar on its bead of glass (black or white with the interface). */}
            <span key={shown} className={cn("avatar-glass block size-full overflow-hidden rounded-full", phase.kind === "ready" && "animate-reveal-pop")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the person's own avatar, served by our route */}
              <img src={shown} alt={t("alt", { name })} className="relative z-[1] size-full object-cover" />
            </span>
          </>
        ) : (
          <span className="flex size-full items-center justify-center rounded-full bg-[conic-gradient(from_200deg,color-mix(in_oklch,var(--pastel-lavender)_30%,transparent),color-mix(in_oklch,var(--pastel-sky)_30%,transparent),color-mix(in_oklch,var(--pastel-mint)_30%,transparent),color-mix(in_oklch,var(--pastel-peach)_30%,transparent),color-mix(in_oklch,var(--pastel-lavender)_30%,transparent))] p-[2px]">
            <span className="avatar-glass flex size-full items-center justify-center rounded-full text-[2.5rem] font-semibold tracking-tight text-muted-foreground">
              {initials(name)}
            </span>
          </span>
        )}
      </div>

      <div className="mt-6 min-h-[1.5rem]" aria-live="polite">
        {phase.kind === "generating" ? <GeneratingLine /> : null}
        {phase.kind === "ready" ? <p className="text-[15px] font-medium">{t("ready")}</p> : null}
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {t(`errors.${error}`)}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {phase.kind === "ready" || phase.kind === "saving" ? (
          <>
            <Button onClick={() => void keep()} disabled={phase.kind === "saving"}>
              {t("choose")}
            </Button>
            <Button variant="outline" onClick={() => lastPhoto.current && void generate(lastPhoto.current)} disabled={busy}>
              <RefreshCwIcon />
              {t("retry")}
            </Button>
            <Button variant="ghost" onClick={() => void discard()} disabled={busy}>
              {t("cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => input.current?.click()} disabled={busy}>
              {current ? <RefreshCwIcon /> : <CameraIcon />}
              {current ? t("replace") : t("upload")}
            </Button>
            {current ? (
              <Button
                variant="ghost"
                disabled={busy || removing}
                onClick={() =>
                  startRemoving(async () => {
                    await removeAvatarAction();
                    setCurrent(null);
                    router.refresh();
                    onDone?.(null);
                  })
                }
              >
                {t("useInitials")}
              </Button>
            ) : null}
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-5 max-w-sm space-y-1.5 text-xs text-muted-foreground">
        {phase.kind === "idle" && !current ? <p>{t("tip")}</p> : null}
        <p>{t("privacy")}</p>
        <p>{testMode ? t("testMode") : t("cost", { credits: format.number(credits, { maximumFractionDigits: 0 }) })}</p>
        {phase.kind === "ready" && phase.test ? (
          <p className="inline-flex items-center gap-1 text-foreground">
            <SparklesIcon className="size-3" />
            {t("testResult")}
          </p>
        ) : null}
        <p className="flex items-center justify-center gap-2 pt-1">
          {t("photoAsIs")} <ComingSoon />
        </p>
      </div>
    </div>
  );
}

/** A few words at a time while the image model works (it takes 10 to 60 seconds). */
function GeneratingLine() {
  const t = useTranslations("avatar");
  const steps = [t("step1"), t("step2"), t("step3"), t("step4")];
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), 4500);
    return () => clearInterval(timer);
  }, [steps.length]);
  return (
    <p key={index} className="text-shimmer animate-message-in text-[15px] font-medium">
      {steps[index]}
    </p>
  );
}

/** Centre-crops to a square, at most 1024 px, re-encoded as JPEG (EXIF and location dropped). */
async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(side, 1024);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", 0.9));
}
