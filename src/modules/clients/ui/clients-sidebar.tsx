"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BriefcaseIcon, LockIcon, PlusIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NewClientDialog } from "./new-client-dialog";

export type SidebarClient = { id: string; name: string; visibility: "open" | "restricted" };

/** Sidebar: the clients worked on lately, a way to all of them, and "+" to add one in place. */
export function ClientsSidebarSection({ clients, canRestrict }: { clients: SidebarClient[]; canRestrict: boolean }) {
  const t = useTranslations("clients");
  const pathname = usePathname();
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="space-y-0.5">
      {/* In the narrow rail: one icon to all clients; the list waits for the full sidebar. */}
      <Tooltip content={t("title")} side="right">
        <Link href="/clients" aria-label={t("title")} aria-current={pathname.startsWith("/clients") ? "page" : undefined} className="glass-interactive mx-auto hidden size-10 items-center justify-center rounded-[11px] text-muted-foreground hover:text-foreground rail:flex">
          <BriefcaseIcon className="size-[17px]" />
        </Link>
      </Tooltip>
      <div className="space-y-0.5 rail:hidden">
        <div className="flex items-center justify-between px-2.5 pb-1 pt-4">
          <Link href="/clients" className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75 hover:text-foreground">
            {t("title")}
          </Link>
          <Tooltip content={t("sidebarAdd")}>
            <button
              type="button"
              aria-label={t("sidebarAdd")}
              onClick={() => setAdding(true)}
              className="glass-interactive -mr-1 flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </Tooltip>
        </div>
        {clients.length === 0 ? (
          <button type="button" onClick={() => setAdding(true)} className="px-2.5 py-1 text-left text-[13px] text-muted-foreground/80 hover:text-foreground">
            {t("sidebarEmpty")}
          </button>
        ) : (
          clients.map((c) => {
            const href = `/clients/${c.id}`;
            const active = pathname === href;
            return (
              <Link
                key={c.id}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "glass-interactive flex h-8 items-center gap-2.5 rounded-[11px] px-2.5 text-[13.5px]",
                  active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-sidebar-accent text-[9px] font-semibold uppercase text-foreground/80">
                  {c.name.trim().charAt(0)}
                </span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.visibility === "restricted" ? <LockIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" /> : null}
              </Link>
            );
          })
        )}
        <Link href="/clients" className="flex h-[26px] items-center px-2.5 text-[12px] text-muted-foreground/80 transition-colors hover:text-foreground">
          {t("sidebarAll")}
        </Link>
      </div>
      <NewClientDialog open={adding} onOpenChange={setAdding} canRestrict={canRestrict} />
    </div>
  );
}
