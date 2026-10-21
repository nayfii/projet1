"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ActivityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/form";
import { testProviderAction } from "../server/actions";

/** "Test now": a tiny request to the provider, without any customer data, then the page refreshes. */
export function ProviderTestButton({ provider, name }: { provider: string; name: string }) {
  const t = useTranslations("platformHealth");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={t("testAria", { name })}
      onClick={() =>
        start(async () => {
          const result = await testProviderAction({ provider });
          if (!result.ok) toast.error(tErrors(result.error));
          else if (result.data?.ok) toast.success(t("testOk", { name, ms: result.data.latencyMs }));
          else toast.error(t("testFailed", { name, reason: t(`codes.${result.data?.code ?? "unknown"}`) }));
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <ActivityIcon />}
      {t("test")}
    </Button>
  );
}
