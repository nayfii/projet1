"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SearchIcon, StarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { setFavoriteAppAction } from "../server/actions";
import { DepartmentIcon } from "./department-icon";

export type BrowserApp = {
  id: string;
  name: string;
  description: string;
  department: string;
  favorite: boolean;
  uses: number;
  soon: boolean;
  byTeam: boolean;
  usable: boolean;
};

/**
 * "Applis" (CLAUDE.md §11), one simple page: quick access (favourites, then recently used), search
 * and departments, and one shelf per department. Starring is instant; the database re-checks.
 */
export function AppsBrowser({ apps, departments, recent }: { apps: BrowserApp[]; departments: { key: string; label: string }[]; recent: string[] }) {
  const t = useTranslations("apps");
  const tErrors = useTranslations("errors");
  const [query, setQuery] = React.useState("");
  const [department, setDepartment] = React.useState<string | null>(null);
  const [favorites, setFavorites] = React.useState(() => new Set(apps.filter((a) => a.favorite).map((a) => a.id)));

  const toggle = async (app: BrowserApp) => {
    const next = !favorites.has(app.id);
    setFavorites((prev) => {
      const s = new Set(prev);
      if (next) s.add(app.id);
      else s.delete(app.id);
      return s;
    });
    const result = await setFavoriteAppAction({ agentId: app.id, favorite: next });
    if (!result.ok) {
      toast.error(tErrors(result.error));
      setFavorites((prev) => {
        const s = new Set(prev);
        if (next) s.delete(app.id);
        else s.add(app.id);
        return s;
      });
    }
  };

  const q = query.trim().toLowerCase();
  const matches = (a: BrowserApp) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
  const popular = apps.filter((a) => a.uses > 0 && !a.soon).sort((a, b) => b.uses - a.uses).slice(0, 4);
  const shown = apps.filter((a) => matches(a) && (!department || a.department === department));

  const card = (a: BrowserApp) => {
    const body = (
      <div className={cn("flex h-full items-start gap-3 glass-standard rounded-2xl border p-4 transition-colors", a.soon ? "opacity-60" : "hover:border-foreground/20 hover:bg-accent/40")}>
        <DepartmentIcon department={a.department} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{a.name}</p>
          {a.description ? <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{a.description}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.soon ? <Badge variant="outline">{t("soon")}</Badge> : null}
            {a.byTeam ? <Badge variant="brand">{t("byTeam")}</Badge> : null}
          </div>
        </div>
      </div>
    );
    return (
      <div key={a.id} className="group relative">
        {a.soon || !a.usable ? body : <Link href={`/apps/${a.id}`} className="block h-full rounded-2xl">{body}</Link>}
        {a.soon ? null : (
          <button
            type="button"
            onClick={() => void toggle(a)}
            aria-pressed={favorites.has(a.id)}
            aria-label={favorites.has(a.id) ? t("unstar", { name: a.name }) : t("star", { name: a.name })}
            className={cn(
              "absolute right-3 top-3 rounded-full p-1.5 transition-opacity hover:bg-accent",
              favorites.has(a.id) ? "text-amber-500" : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <StarIcon className={cn("size-4", favorites.has(a.id) && "fill-current")} />
          </button>
        )}
      </div>
    );
  };

  // Quick access: favourites first, then what this person used lately (each once).
  const quick = [
    ...apps.filter((a) => favorites.has(a.id) && !a.soon),
    ...recent.map((id) => apps.find((a) => a.id === id)).filter((a): a is BrowserApp => Boolean(a && !a.soon && a.usable && !favorites.has(a.id))),
  ].slice(0, 8);

  return (
    <div className="space-y-6">
      {quick.length > 0 ? (
        <section aria-label={t("quickAccess")} className="space-y-2">
          <h2 className="text-[13px] font-medium text-muted-foreground">{t("quickAccess")}</h2>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {quick.map((a) => (
              <Link
                key={a.id}
                href={`/apps/${a.id}`}
                className="flex shrink-0 items-center gap-2 rounded-xl border bg-card py-1.5 pl-1.5 pr-3 text-[13px] font-medium transition-colors hover:border-foreground/20 hover:bg-accent/40"
              >
                <DepartmentIcon department={a.department} className="size-7 rounded-lg" />
                <span className="max-w-44 truncate">{a.name}</span>
                {favorites.has(a.id) ? <StarIcon className="size-3.5 fill-current text-amber-500" aria-label={t("favorite")} /> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="relative w-full sm:w-80">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="pl-9" />
      </div>

      {
        <>
          {!q && !department && popular.length > 0 ? (
            <section className="space-y-3" aria-labelledby="popular">
              <h2 id="popular" className="text-[13px] font-medium text-muted-foreground">
                {t("popular")}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{popular.map(card)}</div>
            </section>
          ) : null}
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("departments")}>
            {[{ key: null as string | null, label: t("all") }, ...departments].map((d) => (
              <button
                key={d.key ?? "all"}
                type="button"
                aria-pressed={department === d.key}
                onClick={() => setDepartment(d.key)}
                className={cn("rounded-full border px-3 py-1 text-[13px] transition-colors", department === d.key ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {d.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMatch")}</p>
          ) : (
            // One shelf per department, like an app store.
            departments
              .filter((d) => shown.some((a) => a.department === d.key))
              .map((d) => (
                <section key={d.key} aria-label={d.label} className="space-y-3">
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    <DepartmentIcon department={d.key} className="size-6 rounded-md" />
                    {d.label}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{shown.filter((a) => a.department === d.key).map(card)}</div>
                </section>
              ))
          )}
        </>
      }
      <p className="text-[13px] text-muted-foreground">{t("createHint")}</p>
    </div>
  );
}
