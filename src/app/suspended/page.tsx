import { getTranslations } from "next-intl/server";
import { PauseCircleIcon } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import AuthLayout from "@/app/(auth)/layout";

/** Shown when the user's company is suspended or their access was deactivated. */
export default async function SuspendedPage() {
  await requireUser();
  const t = await getTranslations("suspended");
  return (
    <AuthLayout>
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PauseCircleIcon className="size-5" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("body")}</p>
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline">
            {t("signOut")}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
