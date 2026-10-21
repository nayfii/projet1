"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTIVITY_CATEGORY_KEYS, ACTIVITY_PERIODS, type ActivityPeriod } from "../categories";

const ALL = "all";

/** Type, person and period filters of the activity log (kept in the address, so a view can be shared). */
export function ActivityFilters({ people }: { people: { id: string; name: string }[] }) {
  const t = useTranslations("activity");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === ALL || (key === "period" && value === "30")) next.delete(key);
    else next.set(key, value);
    next.delete("before");
    router.push(next.size ? `${pathname}?${next}` : pathname);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={params.get("category") ?? ALL} onValueChange={(v) => set("category", v)}>
        <SelectTrigger className="w-52" aria-label={t("filterCategory")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allCategories")}</SelectItem>
          {ACTIVITY_CATEGORY_KEYS.map((c) => (
            <SelectItem key={c} value={c}>
              {t(`categories.${c}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("person") ?? ALL} onValueChange={(v) => set("person", v)}>
        <SelectTrigger className="w-52" aria-label={t("filterPerson")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allPeople")}</SelectItem>
          {people.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("period") ?? "30"} onValueChange={(v) => set("period", v)}>
        <SelectTrigger className="w-48" aria-label={t("filterPeriod")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(ACTIVITY_PERIODS) as ActivityPeriod[]).map((p) => (
            <SelectItem key={p} value={p}>
              {t(`periods.${p}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
