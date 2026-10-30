import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Wordmark: the existing mark (a tile with a dot) kept, the dot now a small pastel orb echoing the assistants' colours.
 * The name lives in messages (common.productName) until the brand is confirmed.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useTranslations("common");
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span aria-hidden className="relative flex size-6 items-center justify-center rounded-[7px] bg-primary">
        <span className="size-2.5 rounded-full bg-[conic-gradient(from_200deg,var(--pastel-lavender),var(--pastel-sky),var(--pastel-mint),var(--pastel-peach),var(--pastel-lavender))] ring-[1.5px] ring-primary-foreground/85" />
      </span>
      {compact ? <span className="sr-only">{t("productName")}</span> : <span>{t("productName")}</span>}
    </span>
  );
}
