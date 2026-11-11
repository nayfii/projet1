"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BriefcaseIcon, LockIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { AvatarStack, VisibilityBadge } from "./client-badges";
import { NewClientDialog } from "./new-client-dialog";
import type { ClientRow } from "../server/queries";

/** The clients this person can open: search, open, or create one in place. */
export function ClientsDirectory({ clients, canRestrict }: { clients: ClientRow[]; canRestrict: boolean }) {
  const t = useTranslations("clients");
  const [query, setQuery] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const q = query.trim().toLowerCase();
  const shown = q ? clients.filter((c) => c.name.toLowerCase().includes(q) || (c.sector ?? "").toLowerCase().includes(q)) : clients;
  const add = (
    <Button onClick={() => setAdding(true)}>
      <PlusIcon />
      {t("add")}
    </Button>
  );
  return (
    <>
      {clients.length === 0 ? (
        <EmptyState icon={<BriefcaseIcon />} title={t("emptyTitle")} description={t("emptyManager")} action={add} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-10 pl-9" />
            </div>
            {add}
          </div>
          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">{t("searchNone")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((c) => (
                <Link key={c.id} href={`/clients/${c.id}`} className="rounded-xl">
                  <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover:border-foreground/20">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.name}</p>
                        {c.sector ? <p className="truncate text-sm text-muted-foreground">{c.sector}</p> : null}
                      </div>
                      <VisibilityBadge visibility={c.visibility} />
                    </div>
                    {/* Who uses this client, so every card reads the same way. */}
                    <div className="mt-auto flex items-center gap-2 border-t pt-3 text-[13px] text-muted-foreground">
                      {c.visibility === "restricted" ? (
                        <>
                          {c.assignees.length > 0 ? <AvatarStack people={c.assignees} /> : <LockIcon className="size-4" />}
                          <span>{c.assignees.length > 0 ? t("assignedCount", { count: c.assignees.length }) : t("noAssigneeYet")}</span>
                        </>
                      ) : (
                        <>
                          <UsersIcon className="size-4" />
                          <span>{t("openForAll")}</span>
                        </>
                      )}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      <NewClientDialog open={adding} onOpenChange={setAdding} canRestrict={canRestrict} defaultName={q && shown.length === 0 ? query.trim() : undefined} />
    </>
  );
}
