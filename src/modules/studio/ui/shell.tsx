"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpenIcon,
  CheckSquareIcon,
  CloudCheckIcon,
  CloudOffIcon,
  FileTextIcon,
  FlagIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  MapIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { useAppearance } from "@/components/appearance/appearance-provider";
import { cn } from "@/lib/utils";
import { CommandMenu } from "./command";
import { CreateDialog, type CreateKind, type CreateDefaults } from "./create";
import { StudioPanel } from "./panel";
import { Kbd } from "./primitives";
import { RememberSpacePath, SpaceSwitch } from "./spaces";
import { useSaveState } from "./store";

export const STUDIO_NAV = [
  { key: "overview", href: "/studio", icon: LayoutDashboardIcon, exact: true, shortcut: "o" },
  { key: "tasks", href: "/studio/tasks", icon: ListTodoIcon, exact: false, shortcut: "t" },
  { key: "roadmap", href: "/studio/roadmap", icon: MapIcon, exact: false, shortcut: "r" },
  { key: "knowledge", href: "/studio/knowledge", icon: BookOpenIcon, exact: false, shortcut: "k" },
] as const;

type ShellUi = { create: (kind: CreateKind, defaults?: CreateDefaults) => void; command: () => void };
const ShellContext = React.createContext<ShellUi>({ create: () => {}, command: () => {} });
export const useShell = () => React.useContext(ShellContext);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || Boolean(el.closest("[role=dialog],[role=menu],[role=listbox]"));
}

/**
 * Studio's frame: four sections, a compact menu that folds to icons, search and creation one key
 * away (⌘K, C), and the Workspace | Studio switch at the same place as in our console.
 */
export function StudioShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("studio.shell");
  const router = useRouter();
  // Folded or not like our console's menu (the same appearance setting on this device).
  const { sidebar, setSidebar } = useAppearance();
  const collapsed = sidebar === "collapsed";
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [creating, setCreating] = React.useState<{ kind: CreateKind; defaults: CreateDefaults } | null>(null);

  const ui = React.useMemo<ShellUi>(
    () => ({
      create: (kind, defaults = {}) => setCreating({ kind, defaults }),
      command: () => setCommandOpen(true),
    }),
    [],
  );

  // ⌘K anywhere; C (new task) and G then a letter (go to a section) when no field is being typed in.
  React.useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const item = STUDIO_NAV.find((n) => n.shortcut === key);
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (key === "g") pendingG = Date.now();
      else if (key === "c") {
        e.preventDefault();
        ui.create("task");
      } else if (key === "/") {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, ui]);

  return (
    <ShellContext.Provider value={ui}>
      <RememberSpacePath space="studio" />
      {/* The same glass frame as our console: the theme's background shows through. */}
      <div className="flex min-h-dvh" data-space="studio">
        <aside data-shell-sidebar className="shell-sidebar sticky top-0 hidden h-dvh shrink-0 md:block">
          <div className="shell-panel-frame">
            <LiquidGlass material="panel" reach={56} className="flex h-full flex-col overflow-hidden rounded-[22px]">
              <SidebarBody collapsed={collapsed} onToggle={() => setSidebar(collapsed ? "expanded" : "collapsed")} />
            </LiquidGlass>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Small screens: a bar with the menu, search and "new". */}
          <LiquidGlass material="panel" reach={14} className="sticky top-0 z-30 flex h-14 items-center gap-2 rounded-none border-b px-3 md:hidden">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("openMenu")}>
                  <MenuIcon />
                </Button>
              </SheetTrigger>
              <SheetContent title={t("navigation")}>
                <SidebarBody collapsed={false} onNavigate={() => setMenuOpen(false)} />
              </SheetContent>
            </Sheet>
            <span className="text-[15px] font-semibold tracking-tight">{t("name")}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label={t("search")} onClick={() => setCommandOpen(true)}>
                <SearchIcon />
              </Button>
              <NewMenu compact />
            </div>
          </LiquidGlass>
          <main className="min-w-0 flex-1 animate-space-in" id="studio-main">
            {children}
          </main>
        </div>
        <StudioPanel />
      </div>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      {creating ? <CreateDialog kind={creating.kind} defaults={creating.defaults} onClose={() => setCreating(null)} /> : null}
    </ShellContext.Provider>
  );
}

function SidebarBody({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const t = useTranslations("studio.shell");
  const tn = useTranslations("studio.nav");
  const pathname = usePathname();
  const ui = useShell();
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center px-2" : "justify-between px-4")}>
        {collapsed ? null : <Logo />}
        {onToggle ? (
          <Tooltip content={collapsed ? t("expand") : t("collapse")} side="right">
            <Button variant="ghost" size="icon-sm" aria-label={collapsed ? t("expand") : t("collapse")} onClick={onToggle} className="text-muted-foreground">
              {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="pb-4">
          <SpaceSwitch current="studio" onNavigate={onNavigate} />
        </div>
      )}

      <div className={cn("flex gap-1.5 pb-3", collapsed ? "flex-col items-center px-2" : "px-3")}>
        {collapsed ? (
          <Tooltip content={t("search")} side="right">
            <Button variant="ghost" size="icon-sm" aria-label={t("search")} onClick={ui.command}>
              <SearchIcon />
            </Button>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              ui.command();
            }}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-sidebar-border bg-background/50 px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SearchIcon className="size-3.5" />
            <span className="flex-1 truncate text-left">{t("search")}</span>
            <Kbd>{"⌘K"}</Kbd>
          </button>
        )}
        <NewMenu compact={collapsed} side={collapsed ? "right" : "bottom"} />
      </div>

      <nav aria-label={t("navigation")} className={cn("min-h-0 flex-1 space-y-0.5 overflow-y-auto py-1", collapsed ? "px-2" : "px-2")}>
        {STUDIO_NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const link = (
            <Link
              key={item.key}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? tn(item.key) : undefined}
              className={cn(
                "group relative flex h-9 items-center gap-2.5 rounded-md text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                collapsed ? "justify-center px-0" : "px-2.5",
                active ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {collapsed ? null : <span className="flex-1 truncate">{tn(item.key)}</span>}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={item.key} content={tn(item.key)} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className={cn("shrink-0 border-t border-border/60 p-2", collapsed && "flex justify-center")}>
        <SaveIndicator compact={collapsed} />
      </div>
    </div>
  );
}

function NewMenu({ compact, side = "bottom" }: { compact?: boolean; side?: "bottom" | "right" }) {
  const t = useTranslations("studio.shell");
  const ui = useShell();
  const items: { kind: CreateKind; icon: React.ComponentType<{ className?: string }>; label: string; hint?: string }[] = [
    { kind: "task", icon: CheckSquareIcon, label: t("newTask"), hint: "C" },
    { kind: "document", icon: FileTextIcon, label: t("newDocument") },
    { kind: "milestone", icon: FlagIcon, label: t("newMilestone") },
  ];
  return (
    <DropdownMenu>
      <Tooltip content={t("new")} side={side === "right" ? "right" : "bottom"}>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" className="size-8 shrink-0 rounded-md" aria-label={t("new")}>
            <PlusIcon />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align={compact ? "end" : "start"} side={side} className="w-52">
        {items.map((i) => (
          <DropdownMenuItem key={i.kind} onSelect={() => ui.create(i.kind)}>
            <i.icon />
            <span className="flex-1">{i.label}</span>
            {i.hint ? <Kbd>{i.hint}</Kbd> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Saved, saving, or failed with a way to retry: discreet, always there. */
function SaveIndicator({ compact }: { compact: boolean }) {
  const t = useTranslations("studio.shell");
  const { pending, failed } = useSaveState();
  const label = failed ? t("saveFailed") : pending ? t("saving") : t("saved");
  const icon = failed ? <CloudOffIcon className="size-3.5 text-destructive" /> : pending ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <CloudCheckIcon className="size-3.5" />;
  if (compact) {
    return (
      <Tooltip content={label} side="right">
        <span role="status" aria-label={label} className="flex size-7 items-center justify-center text-muted-foreground">
          {icon}
        </span>
      </Tooltip>
    );
  }
  return (
    <div role="status" aria-live="polite" className="flex h-7 items-center gap-2 px-2.5 text-xs text-muted-foreground">
      {icon}
      <span className={cn("flex-1", failed && "text-destructive")}>{label}</span>
      {failed ? (
        <button type="button" onClick={failed.retry} className="rounded px-1.5 py-0.5 font-medium text-foreground underline-offset-2 hover:underline">
          {t("retry")}
        </button>
      ) : null}
    </div>
  );
}
