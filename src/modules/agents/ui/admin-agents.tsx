"use client";

import * as React from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ComingSoon } from "@/components/ui/coming-soon";
import { LAUNCH_AGENTS } from "../definitions";
import { decideToolAction, deleteToolAction, setToolRolesAction } from "../server/actions";
import type { AgentDetail } from "../server/queries";
import { AgentBadges } from "./agent-badges";

const ROLES = ["owner", "admin", "member"] as const;

/** Administration → Agents and tools (CLAUDE.md §4.8): approve company-wide tools, choose roles. */
export function AdminAgents({ pending, shared }: { pending: AgentDetail[]; shared: AgentDetail[] }) {
  const t = useTranslations("tools");
  const tErrors = useTranslations("errors");
  const tRoles = useTranslations("roles");
  const format = useFormatter();
  const [busy, startBusy] = React.useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startBusy(async () => {
      const result = await fn();
      if (!result.ok) toast.error(tErrors((result.error ?? "unknown") as "unknown"));
      else toast.success(done);
    });

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("adminPending", { count: pending.length })}</h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("adminNoPending")}</p>
        ) : (
          pending.map((a) => (
            <Card key={a.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("requestedBy", { name: a.creatorName ?? "?", date: format.dateTime(new Date(a.createdAt), { dateStyle: "medium" }) })}
                    {" · "}
                    {t(`departments.${a.department}`)}
                  </p>
                </div>
                <AgentBadges agent={a} />
              </div>
              {a.description ? <p className="text-[13px] text-muted-foreground">{a.description}</p> : null}
              <details className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                <summary className="cursor-pointer font-medium">{t("reviewContent")}</summary>
                <p className="mt-2 text-xs text-muted-foreground">{t("fieldsList", { fields: a.inputFields.map((f) => f.label).join(", ") || "—" })}</p>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">{a.instructions}</p>
              </details>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => act(() => decideToolAction({ id: a.id, approve: true }), t("approved"))}>
                  <CheckIcon />
                  {t("approve")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => decideToolAction({ id: a.id, approve: false }), t("rejectedToast"))}>
                  <XIcon />
                  {t("reject")}
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("adminShared")}</h2>
        <p className="text-[13px] text-muted-foreground">{t("adminSharedHint")}</p>
        {shared.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("adminNoShared")}</p>
        ) : (
          <Card className="divide-y">
            {shared.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <Link href={`/library/${a.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.creatorName ? t("by", { name: a.creatorName }) : null}</span>
                </Link>
                <AgentBadges agent={a} />
                <fieldset className="flex items-center gap-3" aria-label={t("enabledFor", { name: a.name })}>
                  {ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-1.5 text-[13px]">
                      <Checkbox
                        checked={a.enabledRoles.includes(role)}
                        disabled={busy}
                        onCheckedChange={(on) =>
                          act(
                            () => setToolRolesAction({ id: a.id, roles: ROLES.filter((r) => (r === role ? on === true : a.enabledRoles.includes(r))) }),
                            t("rolesSaved"),
                          )
                        }
                      />
                      {tRoles(role)}
                    </label>
                  ))}
                </fieldset>
                <Button variant="ghost" size="icon-sm" aria-label={t("deleteNamed", { name: a.name })} disabled={busy} onClick={() => act(() => deleteToolAction({ id: a.id }), t("deleted"))}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("adminBuiltins")}</h2>
        <p className="text-[13px] text-muted-foreground">{t("adminBuiltinsHint")}</p>
        <Card className="divide-y">
          {LAUNCH_AGENTS.map((a) => (
            <div key={a.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{t(`launch.${a.key}.name`)}</span>
              <span className="text-xs text-muted-foreground">{t(`departments.${a.department}`)}</span>
              <ComingSoon />
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
