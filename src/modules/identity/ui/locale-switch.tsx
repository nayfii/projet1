"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { setLocale } from "../server/actions";
import { cn } from "@/lib/utils";

/** FR / EN switch for screens without the app menu (sign-in, onboarding). */
export function LocaleSwitch({ locale }: { locale: string }) {
  const t = useTranslations("shell");
  const [pending, startTransition] = useTransition();
  return (
    <div role="group" aria-label={t("language")} className="flex rounded-md border bg-card p-0.5 text-xs">
      {(["fr", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          aria-pressed={locale === l}
          onClick={() => startTransition(() => setLocale(l))}
          className={cn(
            "rounded px-2 py-1 font-medium uppercase transition-colors",
            locale === l ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
