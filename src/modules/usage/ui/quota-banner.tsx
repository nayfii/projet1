"use client";

import { useTranslations } from "next-intl";
import { AlertTriangleIcon, OctagonXIcon } from "lucide-react";
import type { QuotaState } from "../quota";
import { cn } from "@/lib/utils";

/** Soft warning from 80 % of the monthly credits, hard stop at 100 % (CLAUDE.md §5). */
export function QuotaBanner({ quota, className }: { quota: QuotaState | null; className?: string }) {
  const t = useTranslations("quota");
  if (!quota || quota.state === "ok") return null;
  const blocked = quota.state === "blocked";
  const scope = quota.scope === "user" ? "User" : "Company";
  const percent = Number.isFinite(quota.ratio) ? Math.min(Math.round(quota.ratio * 100), 100) : 100;
  return (
    <div
      role={blocked ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]",
        blocked ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-foreground",
        className,
      )}
    >
      {blocked ? <OctagonXIcon className="mt-0.5 size-4 shrink-0" /> : <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />}
      <span>{blocked ? t(`blocked${scope}`) : t(`warning${scope}`, { percent })}</span>
    </div>
  );
}
