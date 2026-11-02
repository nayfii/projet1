import { getTranslations } from "next-intl/server";
import { PlugZapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shown until GitHub is connected: what to set, in plain words (details in docs/DEPLOY.md, part 5). */
export async function SetupNotice({ className }: { className?: string }) {
  const t = await getTranslations("platformReleases");
  return (
    <div className={cn("rounded-xl border border-dashed p-5", className)} data-testid="github-setup">
      <p className="flex items-center gap-2 text-sm font-medium">
        <PlugZapIcon className="size-4 text-muted-foreground" />
        {t("setupTitle")}
      </p>
      <p className="mt-2 text-[13px] text-muted-foreground">{t("setupBody")}</p>
    </div>
  );
}
