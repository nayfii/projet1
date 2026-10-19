"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EraserIcon, FileTextIcon, PlusIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AUTO_CATEGORIES, HIDE_MODES, type AutoCategory, type HideMode, type HideSettings } from "../categories";
import { addSensitiveTermAction, removeSensitiveTermAction, saveHideSettingsAction } from "../server/actions";

type Term = { id: string; term: string; category: "client" | "project" | "file" | "term" };
const TERM_CATEGORIES = ["client", "project", "file", "term"] as const;
const MODE_ICONS = { automatic: WandSparklesIcon, documents: FileTextIcon, manual: EraserIcon } as const;

export function HideSettingsForm({ initial, terms }: { initial: HideSettings; terms: Term[] }) {
  const t = useTranslations("hideAdmin");
  const tHide = useTranslations("hide");
  const tErrors = useTranslations("errors");
  const [modes, setModes] = React.useState<Set<HideMode>>(new Set(initial.defaultModes));
  const [categories, setCategories] = React.useState<Set<AutoCategory>>(new Set(initial.autoCategories));
  const [saving, startSaving] = React.useTransition();
  const dirty =
    modes.size !== initial.defaultModes.length ||
    initial.defaultModes.some((m) => !modes.has(m)) ||
    categories.size !== initial.autoCategories.length ||
    initial.autoCategories.some((c) => !categories.has(c));

  const toggle = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">{t("modesTitle")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("modesBody")}</p>
        </div>
        <Card className="divide-y">
          {HIDE_MODES.map((mode) => {
            const Icon = MODE_ICONS[mode];
            return (
              <label key={mode} className="flex items-start justify-between gap-4 p-4">
                <span className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-4 text-brand" />
                  <span>
                    <span className="block text-sm font-medium">{tHide(`mode.${mode}`)}</span>
                    <span className="block text-[13px] text-muted-foreground">{t(`modeBody.${mode}`)}</span>
                  </span>
                </span>
                <Switch checked={modes.has(mode)} onCheckedChange={(on) => setModes((m) => toggle(m, mode, on))} aria-label={tHide(`mode.${mode}`)} />
              </label>
            );
          })}
        </Card>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">{t("categoriesTitle")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("categoriesBody")}</p>
        </div>
        <Card className="divide-y">
          {AUTO_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center justify-between gap-4 px-4 py-3">
              <span>
                <span className="block text-sm">{tHide(`category.${category}`)}</span>
                <span className="block text-[13px] text-muted-foreground">{t(`categoryExample.${category}`)}</span>
              </span>
              <Switch
                checked={categories.has(category)}
                onCheckedChange={(on) => setCategories((c) => toggle(c, category, on))}
                aria-label={tHide(`category.${category}`)}
              />
            </label>
          ))}
        </Card>
        <p className="text-[13px] text-muted-foreground">{t("recallNote")}</p>
      </section>

      <div className="flex justify-end">
        <Button
          disabled={!dirty || saving}
          onClick={() =>
            startSaving(async () => {
              const result = await saveHideSettingsAction({ modes: [...modes], categories: [...categories] });
              if (result.ok) toast.success(t("saved"));
              else toast.error(tErrors(result.error));
            })
          }
        >
          {saving ? <Spinner /> : null}
          {t("save")}
        </Button>
      </div>

      <TermsManager terms={terms} />
    </div>
  );
}

function TermsManager({ terms }: { terms: Term[] }) {
  const t = useTranslations("hideAdmin");
  const tErrors = useTranslations("errors");
  const [category, setCategory] = React.useState<Term["category"]>("project");
  const [busy, startBusy] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("termsTitle")}</h2>
        <p className="text-[13px] text-muted-foreground">{t("termsBody")}</p>
      </div>
      <form
        ref={formRef}
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          const term = String(new FormData(e.currentTarget).get("term") ?? "").trim();
          if (term.length < 2) return;
          startBusy(async () => {
            const result = await addSensitiveTermAction({ term, category });
            if (!result.ok) {
              toast.error(tErrors(result.error));
              return;
            }
            toast.success(t("termAdded"));
            formRef.current?.reset();
          });
        }}
      >
        <Input name="term" required minLength={2} maxLength={200} placeholder={t("termPlaceholder")} aria-label={t("termLabel")} className="flex-1" />
        <Select value={category} onValueChange={(v) => setCategory(v as Term["category"])}>
          <SelectTrigger className="sm:w-48" aria-label={t("termCategory")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TERM_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`termCategories.${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? <Spinner /> : <PlusIcon />}
          {t("addTerm")}
        </Button>
      </form>
      {terms.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("noTerms")}</p>
      ) : (
        <Card className="divide-y overflow-hidden">
          {terms.map((term) => (
            <div key={term.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm">{term.term}</span>
              <Badge variant="neutral">{t(`termCategories.${term.category}`)}</Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("removeTerm", { term: term.term })}
                disabled={busy}
                onClick={() =>
                  startBusy(async () => {
                    const result = await removeSensitiveTermAction({ termId: term.id });
                    if (result.ok) toast.success(t("termRemoved"));
                    else toast.error(tErrors(result.error));
                  })
                }
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </Card>
      )}
      <p className="text-[13px] text-muted-foreground">{t("listsNote")}</p>
    </section>
  );
}
