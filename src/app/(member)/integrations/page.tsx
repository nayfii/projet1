import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { ComingSoon } from "@/components/ui/coming-soon";
import { isProviderId, PROVIDERS } from "@/modules/integrations/providers";
import { integrationsPageData } from "@/modules/integrations/server/queries";
import { IntegrationsCatalog } from "@/modules/integrations/ui/catalog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("integrations");
  return { title: t("title") };
}

const ERRORS = ["state", "denied", "forbidden", "exchange_failed", "not_configured", "no_key", "disabled", "soon", "no_app", "not_found"] as const;

/** Intégrations (CLAUDE.md §12): the apps the company works with, connected once and used by the chat, Conscience and workflows. */
export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  const ctx = await requireMember();
  const params = await searchParams;
  const [t, data] = await Promise.all([getTranslations("integrations"), integrationsPageData(ctx)]);
  const connected = typeof params.connected === "string" && isProviderId(params.connected) ? PROVIDERS[params.connected].name : null;
  const error = typeof params.error === "string" ? (ERRORS as readonly string[]).includes(params.error) ? params.error : "exchange_failed" : null;

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title={t("title")} description={t("description")} />
      {!data.ready ? (
        <div className="flex items-center gap-3 rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          <ComingSoon />
          {t("notReady")}
        </div>
      ) : (
        <div className="space-y-6">
          {connected ? (
            <p role="status" className="flex items-center gap-2 rounded-xl border bg-success-soft px-4 py-3 text-sm">
              <CheckCircle2Icon className="size-4 text-success" />
              {t("connectedBanner", { name: connected })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="flex items-center gap-2 rounded-xl border bg-warning-soft px-4 py-3 text-sm">
              <CircleAlertIcon className="size-4 text-warning" />
              {t(`callbackError.${error as (typeof ERRORS)[number]}`)}
            </p>
          ) : null}
          {!data.keyConfigured && data.canGovern ? <p className="rounded-xl border px-4 py-3 text-[13px] text-muted-foreground">{t("noKeyNotice")}</p> : null}
          <IntegrationsCatalog availability={data.availability} connections={data.connections} canGovern={data.canGovern} />
          <p className="text-xs text-muted-foreground">{t("footer")}</p>
        </div>
      )}
    </PageContainer>
  );
}
