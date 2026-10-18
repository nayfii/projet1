import { useTranslations } from "next-intl";
import { Badge } from "./badge";

/** Visible marker for anything not built yet (CLAUDE.md §9: no button that does nothing). */
function ComingSoon({ className }: { className?: string }) {
  const t = useTranslations("common");
  return (
    <Badge variant="outline" className={className}>
      {t("comingSoon")}
    </Badge>
  );
}

export { ComingSoon };
