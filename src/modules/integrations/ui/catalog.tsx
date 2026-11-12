"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2Icon, CircleAlertIcon, PlugIcon, RefreshCwIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ComingSoon } from "@/components/ui/coming-soon";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_LIST, type ProviderDef } from "../providers";
import type { ProviderAvailability } from "../server/access";
import type { ConnectionView } from "../server/queries";
import { checkConnectionAction, revokeConnectionAction, setProviderEnabledAction } from "../server/actions";

/**
 * The integrations catalogue: each app, what Cendr can do with it (read / write, where), the
 * permissions asked in plain words, its limits, and the connections — connect, check, reconnect,
 * revoke. Company-wide switches and connections for the Owner and Admins with the "models" scope.
 */
export function IntegrationsCatalog({ availability, connections, canGovern }: { availability: ProviderAvailability[]; connections: ConnectionView[]; canGovern: boolean }) {
  return (
    <div className="space-y-4" data-testid="integrations-catalog">
      {PROVIDER_LIST.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          availability={availability.find((a) => a.id === provider.id)!}
          connections={connections.filter((c) => c.provider === provider.id)}
          canGovern={canGovern}
        />
      ))}
    </div>
  );
}

function ProviderCard({ provider, availability, connections, canGovern }: { provider: ProviderDef; availability: ProviderAvailability; connections: ConnectionView[]; canGovern: boolean }) {
  const t = useTranslations("integrations");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [connecting, setConnecting] = React.useState(false);
  const [pending, start] = React.useTransition();
  const soon = provider.status === "soon";
  const disabledByCompany = availability.companyDisabled;

  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby={`provider-${provider.id}`} data-testid={`provider-${provider.id}`}>
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold" aria-hidden>
          {provider.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={`provider-${provider.id}`} className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-tight">
            {provider.name}
            {soon ? <ComingSoon /> : null}
          </h2>
          <p className="text-sm text-muted-foreground">{t(`provider.${provider.id}.body`)}</p>
        </div>
        {canGovern && !soon ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("allowed")}
            <Switch
              checked={!disabledByCompany}
              disabled={pending}
              aria-label={t("allowFor", { name: provider.name })}
              onCheckedChange={(enabled) =>
                start(async () => {
                  const result = await setProviderEnabledAction({ provider: provider.id, enabled });
                  if (!result.ok) toast.error(tErrors(result.error));
                  else router.refresh();
                })
              }
            />
          </label>
        ) : null}
      </div>

      {!soon ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">{t("canDo")}</h3>
            <ul className="space-y-1 text-[13px]">
              {provider.capabilities.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-px shrink-0 px-1.5 text-[10.5px]">
                    {c.kind === "read" ? t("read") : t("write")}
                  </Badge>
                  <span>
                    {t(`capability.${c.id.replace(".", "_")}` as "capability.gmail_search")}
                    <span className="text-muted-foreground"> · {c.uses.map((u) => t(`use.${u}`)).join(", ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">{t("limits")}</h3>
            <p className="text-[13px] text-muted-foreground">{t(`provider.${provider.id}.limits`)}</p>
          </div>
        </div>
      ) : null}

      {connections.length > 0 ? (
        <ul className="mt-4 divide-y rounded-xl border" data-testid="connections">
          {connections.map((c) => (
            <ConnectionRow key={c.id} connection={c} canGovern={canGovern} />
          ))}
        </ul>
      ) : null}

      {!soon ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {availability.ready ? (
            <Button size="sm" variant="outline" onClick={() => setConnecting(true)}>
              <PlugIcon />
              {t("connect")}
            </Button>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground" data-testid="not-ready">
              <CircleAlertIcon className="size-4 shrink-0" />
              {t(`reason.${availability.reason ?? "not_configured"}`)}
            </p>
          )}
        </div>
      ) : null}

      {connecting ? <ConnectDialog provider={provider} canGovern={canGovern} onClose={() => setConnecting(false)} /> : null}
    </section>
  );
}

function ConnectionRow({ connection: c, canGovern }: { connection: ConnectionView; canGovern: boolean }) {
  const t = useTranslations("integrations");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [revoking, setRevoking] = React.useState(false);
  const [pending, start] = React.useTransition();
  const mayManage = c.mine || canGovern;
  const scopeQuery = c.scope === "company" ? "company" : "personal";

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {c.accountLabel ?? t("unknownAccount")}
          <Badge variant="outline">{c.scope === "company" ? t("scope.company") : t("scope.personal")}</Badge>
          {c.status === "active" ? (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2Icon className="size-3.5" />
              {t("status.active")}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-warning">
              <CircleAlertIcon className="size-3.5" />
              {t("status.expired")}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("connectedBy", { name: c.mine ? t("you") : (c.ownerName ?? "?") })} · {c.apps.map((a) => t(`app.${a}` as "app.gmail")).join(", ")}
          {c.lastUsedAt ? ` · ${t("lastUsed", { when: format.relativeTime(new Date(c.lastUsedAt)) })}` : ""}
        </p>
      </div>
      {mayManage ? (
        <div className="flex items-center gap-1">
          {c.status !== "active" && c.mine ? (
            <Button asChild size="sm" variant="outline">
              <a href={`/api/integrations/${c.provider}/connect?scope=${scopeQuery}&apps=${c.apps.join(",")}`}>{t("reconnect")}</a>
            </Button>
          ) : null}
          {c.mine ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await checkConnectionAction({ connectionId: c.id });
                  if (!result.ok) toast.error(tErrors(result.error));
                  else if (result.data!.status === "active") toast.success(t("checkOk"));
                  else toast.error(t("checkExpired"));
                  router.refresh();
                })
              }
            >
              <RefreshCwIcon />
              {t("check")}
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" aria-label={t("revoke")} onClick={() => setRevoking(true)}>
            <Trash2Icon />
          </Button>
        </div>
      ) : null}
      <Dialog open={revoking} onOpenChange={setRevoking}>
        <DialogContent className="max-w-md" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{t("revokeTitle")}</DialogTitle>
            <DialogDescription>{t("revokeBody", { account: c.accountLabel ?? t("unknownAccount") })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await revokeConnectionAction({ connectionId: c.id });
                  if (!result.ok) toast.error(tErrors(result.error));
                  else toast.success(t("revoked"));
                  setRevoking(false);
                  router.refresh();
                })
              }
            >
              {t("revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** Choose the apps (only their permissions are asked) and, for the Owner and Admins, who it is for. */
function ConnectDialog({ provider, canGovern, onClose }: { provider: ProviderDef; canGovern: boolean; onClose: () => void }) {
  const t = useTranslations("integrations");
  const [apps, setApps] = React.useState<string[]>(provider.apps.length === 1 ? [provider.apps[0].id] : []);
  const [scope, setScope] = React.useState<"personal" | "company">("personal");
  const href = `/api/integrations/${provider.id}/connect?scope=${scope}&apps=${apps.join(",")}`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" closeLabel={t("cancel")}>
        <DialogHeader>
          <DialogTitle>{t("connectTitle", { name: provider.name })}</DialogTitle>
          <DialogDescription>{t("connectBody")}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">{t("whichApps")}</legend>
          {provider.apps.map((a) => (
            <label key={a.id} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
              <Checkbox
                checked={apps.includes(a.id)}
                disabled={provider.apps.length === 1}
                onCheckedChange={(v) => setApps((list) => (v === true ? [...list, a.id] : list.filter((x) => x !== a.id)))}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{t(`app.${a.id}` as "app.gmail")}</span>
                <span className="block text-xs text-muted-foreground">{t(`access.${a.id}` as "access.gmail")}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {canGovern ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">{t("forWhom")}</legend>
            {(["personal", "company"] as const).map((s) => (
              <label key={s} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
                <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} className="mt-1 accent-current" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{t(`scope.${s}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`scopeBody.${s}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
          {t("connectSafety", { name: provider.name })}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          {apps.length > 0 ? (
            <Button asChild>
              <a href={href}>{t("continueTo", { name: provider.name })}</a>
            </Button>
          ) : (
            <Button disabled>{t("continueTo", { name: provider.name })}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
