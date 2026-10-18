import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("system");
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-medium text-brand">{t("notFoundCode")}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFoundTitle")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("notFoundBody")}</p>
      <Button asChild variant="outline">
        <Link href="/">{t("home")}</Link>
      </Button>
    </div>
  );
}
