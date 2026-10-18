"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GlobeIcon, LockIcon } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { createClientAction } from "../server/actions";
import { cn } from "@/lib/utils";

export function ClientForm({
  members,
  submitLabel,
  onCreated,
  secondary,
}: {
  members: { userId: string; name: string }[];
  submitLabel: string;
  onCreated?: (id: string) => void;
  secondary?: React.ReactNode;
}) {
  const t = useTranslations("clients");
  const tErrors = useTranslations("errors");
  const [state, action] = useActionState(createClientAction, null);
  const [visibility, setVisibility] = useState<"open" | "restricted">("open");

  useEffect(() => {
    if (state?.ok && state.data) onCreated?.(state.data.id);
  }, [state, onCreated]);

  return (
    <form action={action} className="space-y-5">
      <Field label={t("name")} htmlFor="client-name" error={state && !state.ok && state.fields?.name ? t("nameRequired") : undefined}>
        <Input id="client-name" name="name" required maxLength={160} placeholder={t("namePlaceholder")} />
      </Field>
      <Field label={t("sector")} htmlFor="client-sector">
        <Input id="client-sector" name="sector" maxLength={120} placeholder={t("sectorPlaceholder")} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">{t("visibility")}</legend>
        <input type="hidden" name="visibility" value={visibility} />
        <div className="grid gap-2 sm:grid-cols-2">
          {(["open", "restricted"] as const).map((v) => {
            const Icon = v === "open" ? GlobeIcon : LockIcon;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={visibility === v}
                onClick={() => setVisibility(v)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  visibility === v ? "border-brand bg-brand-soft/60" : "hover:bg-accent",
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", visibility === v ? "text-brand" : "text-muted-foreground")} />
                <span>
                  <span className="block text-sm font-medium">{t(v === "open" ? "visibilityOpen" : "visibilityRestricted")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(v === "open" ? "visibilityOpenHint" : "visibilityRestrictedHint")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {visibility === "restricted" ? (
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">{t("assignees")}</legend>
          {members.length > 0 ? (
            <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
              {members.map((m) => (
                <label key={m.userId} className="flex items-center gap-2 text-sm">
                  <Checkbox name="assignees" value={m.userId} />
                  <span className="truncate">{m.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">{t("noAssigneesYet")}</p>
          )}
          <p className="text-xs text-muted-foreground">{t("ownerAlwaysAccess")}</p>
        </fieldset>
      ) : null}

      <Field label={t("description")} htmlFor="client-description">
        <Textarea id="client-description" name="description" rows={3} maxLength={4000} placeholder={t("descriptionPlaceholder")} />
      </Field>

      {state && !state.ok && state.error !== "validation" ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
      <div className="flex items-center justify-between gap-3">
        <div>{secondary}</div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
