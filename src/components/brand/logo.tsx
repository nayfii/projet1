import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Placeholder wordmark until the brand is chosen: the name lives in messages (common.productName). */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useTranslations("common");
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span aria-hidden className="relative flex size-6 items-center justify-center rounded-md bg-primary">
        <span className="size-2.5 rounded-full bg-brand ring-2 ring-primary-foreground/90" />
      </span>
      {compact ? <span className="sr-only">{t("productName")}</span> : <span>{t("productName")}</span>}
    </span>
  );
}
