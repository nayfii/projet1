"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutGridIcon, SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Our team's two spaces: Workspace (our console: companies, plans, versions…) and Studio (building and
 * running Cendr). The same switch sits at the same place at the top of both menus; each space comes
 * back to the page it was left on (this browser only).
 */
export type Space = "workspace" | "studio";

const KEY: Record<Space, string> = { workspace: "cendr-space:platform", studio: "cendr-space:studio" };
const HOME: Record<Space, string> = { workspace: "/platform", studio: "/studio" };

/** Remembers the last page seen in a space. Renders nothing. */
export function RememberSpacePath({ space }: { space: Space }) {
  const pathname = usePathname();
  const params = useSearchParams();
  React.useEffect(() => {
    const qs = new URLSearchParams(params.toString());
    qs.delete("open");
    const path = qs.toString() ? `${pathname}?${qs}` : pathname;
    try {
      localStorage.setItem(KEY[space], path);
    } catch {
      // Not kept: each space opens on its home page.
    }
  }, [pathname, params, space]);
  return null;
}

export function lastPath(space: Space): string | null {
  try {
    const value = localStorage.getItem(KEY[space]);
    const home = HOME[space];
    return value && (value === home || value.startsWith(`${home}/`) || value.startsWith(`${home}?`)) ? value : null;
  } catch {
    return null;
  }
}

const subscribeNothing = () => () => {};

export function SpaceSwitch({ current, onNavigate }: { current: Space; onNavigate?: () => void }) {
  const t = useTranslations("studio.spaces");
  // The other space's last page is known in this browser only (the server renders its home page).
  const otherHref = React.useSyncExternalStore(
    subscribeNothing,
    () => lastPath(current === "studio" ? "workspace" : "studio") ?? HOME[current === "studio" ? "workspace" : "studio"],
    () => HOME[current === "studio" ? "workspace" : "studio"],
  );
  const items: { space: Space; icon: React.ComponentType<{ className?: string }> }[] = [
    { space: "workspace", icon: LayoutGridIcon },
    { space: "studio", icon: SparklesIcon },
  ];
  return (
    <nav aria-label={t("label")} className="px-3">
      <div className="relative grid grid-cols-2 rounded-full border border-sidebar-border bg-background/50 p-0.5 text-[13px]">
        {/* The highlight slides under the active space. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-foreground shadow-sm transition-transform duration-300 ease-[var(--ease-out-soft)]",
            current === "studio" && "translate-x-full",
          )}
        />
        {items.map(({ space, icon: Icon }) =>
          space === current ? (
            <span key={space} aria-current="page" className="relative z-10 flex h-7 items-center justify-center gap-1.5 font-medium text-background">
              <Icon className="size-3.5" />
              {t(space)}
            </span>
          ) : (
            <Link
              key={space}
              href={otherHref}
              onClick={onNavigate}
              title={t(space === "studio" ? "toStudio" : "toWorkspace")}
              className="relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-3.5" />
              {t(space)}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
