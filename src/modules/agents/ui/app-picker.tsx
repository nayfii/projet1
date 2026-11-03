"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { StarIcon } from "lucide-react";
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

/** The list above the message box ("Applis" button, or "/" at the start of a message). */
export function AppPickerMenu({ apps, loading, active, onPick }: { apps: PickerApp[]; loading: boolean; active: number; onPick: (app: PickerApp) => void }) {
  const t = useTranslations("apps");
  return (
    <div role="listbox" aria-label={t("picker")} className="absolute bottom-full left-2 z-20 mb-2 w-80 rounded-xl border bg-popover p-1 shadow-lg">
      <p className="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">{t("pickerSearch")}</p>
      {apps.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">{loading ? "…" : t("pickerEmpty")}</p>
      ) : (
        apps.map((a, i) => (
          <button
            key={a.id}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(a)}
            className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm", i === active ? "bg-accent" : "hover:bg-accent/60")}
          >
            <DepartmentIcon department={a.department} className="size-7 rounded-lg" />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            {a.favorite ? <StarIcon className="size-3.5 fill-current text-amber-400" aria-hidden /> : null}
          </button>
        ))
      )}
      <Link href="/apps" className="mt-1 block border-t px-2 pb-1 pt-2 text-xs text-muted-foreground hover:text-foreground">
        {t("pickerAll")}
      </Link>
    </div>
  );
}
