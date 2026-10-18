"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input, Textarea } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateCompanyProfileAction } from "../server/actions";

const SIZES = ["1-5", "6-10", "11-25", "26-50", "51-200", "200+"] as const;

export type CompanyProfileValues = {
  name: string;
  industry: string | null;
  sizeRange: string | null;
  website: string | null;
  description: string | null;
};

export function CompanyProfileForm({
  initial,
  submitLabel,
  onSaved,
  secondary,
}: {
  initial: CompanyProfileValues;
  submitLabel: string;
  onSaved?: () => void;
  secondary?: React.ReactNode;
}) {
  const t = useTranslations("company");
  const tErrors = useTranslations("errors");
  const [state, action] = useActionState(updateCompanyProfileAction, null);

  useEffect(() => {
    if (state?.ok) {
      if (onSaved) onSaved();
      else toast.success(t("saved"));
    }
  }, [state, onSaved, t]);

  return (
    <form action={action} className="space-y-5">
      <Field label={t("name")} htmlFor="name">
        <Input id="name" name="name" defaultValue={initial.name} required maxLength={120} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("industry")} htmlFor="industry">
          <Input id="industry" name="industry" defaultValue={initial.industry ?? ""} placeholder={t("industryPlaceholder")} maxLength={120} />
        </Field>
        <Field label={t("size")} htmlFor="sizeRange">
          <Select name="sizeRange" defaultValue={initial.sizeRange ?? undefined}>
            <SelectTrigger id="sizeRange">
              <SelectValue placeholder={t("sizePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t("sizeOption", { range: s })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label={t("website")} htmlFor="website">
        <Input id="website" name="website" type="url" defaultValue={initial.website ?? ""} placeholder={t("websitePlaceholder")} />
      </Field>
      <Field label={t("description")} htmlFor="description" hint={t("descriptionHint")}>
        <Textarea id="description" name="description" defaultValue={initial.description ?? ""} rows={4} maxLength={2000} placeholder={t("descriptionPlaceholder")} />
      </Field>
      {state && !state.ok ? <FormMessage>{tErrors(state.error)}</FormMessage> : null}
      <div className="flex items-center justify-between gap-3">
        <div>{secondary}</div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
