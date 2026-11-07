"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileTextIcon, ImageIcon, PresentationIcon, StarIcon, TableIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { listPickerAppsAction, type PickerApp } from "../server/actions";
import { DepartmentIcon } from "./department-icon";

/** The apps one can start from a conversation, loaded once when first needed. */
export function usePickerApps(enabled: boolean) {
  const [apps, setApps] = React.useState<PickerApp[] | null>(null);
  React.useEffect(() => {
    if (!enabled || apps) return;
    let cancelled = false;
    void listPickerAppsAction().then((list) => {
      if (!cancelled) setApps(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, apps]);
  return apps;
}

export function filterApps(apps: PickerApp[] | null, query: string): PickerApp[] {
  const q = query.trim().toLowerCase();
  return (apps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 8);
}

/**
 * "/" shortcuts that start something in the conversation itself (not an app's form): a document, a
 * presentation, a spreadsheet (they open in the workspace on the right) or an image.
 */
export const CREATE_SHORTCUTS = ["document", "slides", "sheet", "image"] as const;
export type CreateShortcut = (typeof CREATE_SHORTCUTS)[number];
const SHORTCUT_WORDS: Record<CreateShortcut, string[]> = {
  document: ["document", "doc", "rapport", "report", "facture", "invoice", "devis", "quote"],
  slides: ["presentation", "présentation", "slides", "diapo", "deck"],
  sheet: ["tableau", "sheet", "excel", "spreadsheet", "budget"],
  image: ["image", "photo", "illustration"],
};
const SHORTCUT_ICONS: Record<CreateShortcut, React.ComponentType<{ className?: string }>> = {
  document: FileTextIcon,
  slides: PresentationIcon,
  sheet: TableIcon,
  image: ImageIcon,
};

/** The shortcuts matching what follows "/" (all of them for an empty query). */
export function filterShortcuts(query: string, image: boolean): CreateShortcut[] {
  const q = query.trim().toLowerCase();
  return CREATE_SHORTCUTS.filter((s) => (s !== "image" || image) && (!q || SHORTCUT_WORDS[s].some((w) => w.startsWith(q))));
}

/** The list above the message box ("Applis" button, or "/" at the start of a message). */
export function AppPickerMenu({
  apps,
  shortcuts = [],
  loading,
  active,
  onPick,
  onShortcut,
}: {
  apps: PickerApp[];
  /** Shown first; `active` counts them before the apps. */
  shortcuts?: CreateShortcut[];
  loading: boolean;
  active: number;
  onPick: (app: PickerApp) => void;
  onShortcut?: (shortcut: CreateShortcut) => void;
}) {
  const t = useTranslations("apps");
  return (
    <div role="listbox" aria-label={t("picker")} className="absolute bottom-full left-2 z-20 mb-2 w-80 rounded-xl border bg-popover p-1 shadow-lg">
      {shortcuts.length > 0 ? (
        <>
          <p className="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">{t("shortcutsTitle")}</p>
          {shortcuts.map((s, i) => {
            const Icon = SHORTCUT_ICONS[s];
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onShortcut?.(s)}
                className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm", i === active ? "bg-accent" : "hover:bg-accent/60")}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground/80">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{t(`shortcut.${s}`)}</span>
                <span className="text-xs text-muted-foreground">{`/${t(`shortcutCommand.${s}`)}`}</span>
              </button>
            );
          })}
        </>
      ) : null}
      <p className="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">{t("pickerSearch")}</p>
      {apps.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">{loading ? "…" : t("pickerEmpty")}</p>
      ) : (
        apps.map((a, i) => (
          <button
            key={a.id}
            type="button"
            role="option"
            aria-selected={i + shortcuts.length === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(a)}
            className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm", i + shortcuts.length === active ? "bg-accent" : "hover:bg-accent/60")}
          >
            <DepartmentIcon department={a.department} className="size-7 rounded-lg" />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            {a.favorite ? <StarIcon className="size-3.5 fill-current text-amber-500" aria-hidden /> : null}
          </button>
        ))
      )}
      <Link href="/apps" className="mt-1 block border-t px-2 pb-1 pt-2 text-xs text-muted-foreground hover:text-foreground">
        {t("pickerAll")}
      </Link>
    </div>
  );
}
