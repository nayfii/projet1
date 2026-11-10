"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArchiveIcon, ArrowLeftIcon, CloudCheckIcon, CloudOffIcon, KeyboardIcon, LoaderCircleIcon, MenuIcon, PlusIcon, SearchIcon, SlidersHorizontalIcon, TrendingUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Logo } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CaptureDialog, type CaptureDefaults } from "./capture";
import { SCALE_NAV } from "./nav";
import { NotificationsMenu } from "./notifications";
import { ScalePanel } from "./panel";
import { RescheduleProvider } from "./reschedule";
import { Kbd } from "./primitives";
import { SearchDialog } from "./search";
import { lastPath, RememberSpacePath } from "./space-memory";
import { useSaveState } from "./store";

type ShellUi = { capture: (defaults?: CaptureDefaults) => void; search: () => void };
const ShellContext = React.createContext<ShellUi>({ capture: () => {}, search: () => {} });
export const useShell = () => React.useContext(ShellContext);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || Boolean(el.closest("[role=dialog],[role=menu],[role=listbox]"));
}

/**
 * Scale's frame: its own navigation, clearly named, with our console one click away. Nothing here is
 * shared with the console's frame, so the console looks and behaves exactly as before.
 */
export function ScaleShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("scale.shell");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [captureDefaults, setCaptureDefaults] = React.useState<CaptureDefaults>({});
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Coming from the console's "Scale" link: back to the last page used in Scale.
  React.useEffect(() => {
    if (params.get("resume") !== "1") return;
    const last = lastPath("scale");
    router.replace(last && last !== "/scale" ? last : "/scale");
  }, [params, router]);

  const ui = React.useMemo<ShellUi>(
    () => ({
      capture: (defaults = {}) => {
        setCaptureDefaults(defaults);
        setCaptureOpen(true);
      },
      search: () => setSearchOpen(true),
    }),
    [],
  );

  // Shortcuts, only when no field is being typed in: C capture, / or ⌘K search, G then a letter to move, ? help.
  React.useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const item = SCALE_NAV.find((n) => n.shortcut === key);
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (key === "g") pendingG = Date.now();
      else if (key === "c") {
        e.preventDefault();
        ui.capture();
      } else if (key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, ui]);

  const [platformHref, setPlatformHref] = React.useState("/platform");
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the last console page is known in the browser only
    setPlatformHref(lastPath("platform") ?? "/platform");
  }, [pathname]);

  const sidebar = (onNavigate?: () => void) => (
    <SidebarBody platformHref={platformHref} pathname={pathname} onNavigate={onNavigate} onSearch={() => setSearchOpen(true)} onCapture={() => ui.capture()} onHelp={() => setHelpOpen(true)} />
  );

  return (
    <ShellContext.Provider value={ui}>
      <RememberSpacePath space="scale" />
      <RescheduleProvider>
      <div className="flex min-h-dvh bg-background" data-space="scale">
        <aside className="sticky top-0 hidden h-dvh w-[15.5rem] shrink-0 border-r border-sidebar-border bg-sidebar md:flex">{sidebar()}</aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Small screens: a bar with the space name, search, capture and the menu. */}
          <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:hidden">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("openMenu")}>
                  <MenuIcon />
                </Button>
              </SheetTrigger>
              <SheetContent title={t("navigation")}>{sidebar(() => setMenuOpen(false))}</SheetContent>
            </Sheet>
            <SpaceMark />
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label={t("search")} onClick={() => setSearchOpen(true)}>
                <SearchIcon />
              </Button>
              <NotificationsMenu />
              <Button size="icon-sm" aria-label={t("capture")} onClick={() => ui.capture()}>
                <PlusIcon />
              </Button>
            </div>
          </div>
          <main className="min-w-0 flex-1" id="scale-main">
            {children}
          </main>
        </div>
        <ScalePanel />
      </div>
      </RescheduleProvider>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <CaptureDialog open={captureOpen} onOpenChange={setCaptureOpen} defaults={captureDefaults} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </ShellContext.Provider>
  );
}

/** "Scale — Développement de Cendr": the name of the space, always visible. */
function SpaceMark({ large = false }: { large?: boolean }) {
  const t = useTranslations("scale.shell");
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-lg bg-foreground text-background", large ? "size-8" : "size-7")}>
        <TrendingUpIcon className={large ? "size-4" : "size-3.5"} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className={cn("block font-semibold tracking-tight", large ? "text-[17px]" : "text-[15px]")}>{t("name")}</span>
        <span className="block truncate text-xs text-muted-foreground">{t("subtitle")}</span>
      </span>
    </span>
  );
}

function SidebarBody({
  platformHref,
  pathname,
  onNavigate,
  onSearch,
  onCapture,
  onHelp,
}: {
  platformHref: string;
  pathname: string;
  onNavigate?: () => void;
  onSearch: () => void;
  onCapture: () => void;
  onHelp: () => void;
}) {
  const t = useTranslations("scale.shell");
  const tn = useTranslations("scale.nav");
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <NotificationsMenu className="hidden md:inline-flex" />
      </div>

      {/* The two spaces of our console, the active one highlighted. */}
      <nav aria-label={t("spaces")} className="px-3">
        <div className="grid grid-cols-2 gap-0.5 rounded-full border bg-background/60 p-0.5 text-[13px]">
          <Link href={platformHref} onClick={onNavigate} className="flex h-7 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {t("platform")}
          </Link>
          <span aria-current="page" className="flex h-7 items-center justify-center rounded-full bg-foreground font-medium text-background">
            {t("name")}
          </span>
        </div>
      </nav>

      <div className="px-4 pb-3 pt-5">
        <SpaceMark large />
      </div>

      <div className="flex gap-1.5 px-3 pb-3">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background/60 px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SearchIcon className="size-3.5" />
          <span className="flex-1 truncate text-left">{t("search")}</span>
          <Kbd>/</Kbd>
        </button>
        <Button size="icon-sm" className="size-8 rounded-md" aria-label={t("capture")} title={t("captureHint")} onClick={onCapture}>
          <PlusIcon />
        </Button>
      </div>

      <nav aria-label={t("navigation")} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {SCALE_NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
            >
              {active ? <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-foreground" /> : null}
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 truncate">{tn(item.key)}</span>
            </Link>
          );
        })}
        <div className="pt-4">
          {[
            { href: "/scale/archive", label: tn("archive"), icon: ArchiveIcon },
            { href: "/scale/settings", label: tn("settings"), icon: SlidersHorizontalIcon },
          ].map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn("flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground")}
              >
                <item.icon className="size-3.5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
          <button type="button" onClick={onHelp} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <KeyboardIcon className="size-3.5 shrink-0" />
            {tn("shortcuts")}
          </button>
        </div>
      </nav>

      <div className="space-y-1 border-t border-sidebar-border p-2">
        <SaveIndicator />
        <Link
          href={platformHref}
          onClick={onNavigate}
          className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon className="size-4" />
          {t("backToPlatform")}
        </Link>
      </div>
    </div>
  );
}

/** Saving state of Scale, always visible: saved, saving, or failed with a way to retry. */
function SaveIndicator() {
  const t = useTranslations("scale.shell");
  const { pending, failed } = useSaveState();
  return (
    <div role="status" aria-live="polite" className="flex h-7 items-center gap-2 px-2.5 text-xs text-muted-foreground">
      {failed ? (
        <>
          <CloudOffIcon className="size-3.5 text-destructive" />
          <span className="flex-1 text-destructive">{t("saveFailed")}</span>
          <button type="button" onClick={failed.retry} className="rounded px-1.5 py-0.5 font-medium text-foreground underline-offset-2 hover:underline">
            {t("retry")}
          </button>
        </>
      ) : pending ? (
        <>
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          {t("saving")}
        </>
      ) : (
        <>
          <CloudCheckIcon className="size-3.5" />
          {t("saved")}
        </>
      )}
    </div>
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("scale.shortcuts");
  const tn = useTranslations("scale.nav");
  const tc = useTranslations("scale.common");
  const rows: [React.ReactNode, string][] = [
    [<Kbd key="c">{"C"}</Kbd>, t("capture")],
    [
      <span key="s" className="flex gap-1">
        <Kbd>/</Kbd>
        <Kbd>{"⌘K"}</Kbd>
      </span>,
      t("search"),
    ],
    ...SCALE_NAV.map(
      (n) =>
        [
          <span key={n.key} className="flex gap-1">
            <Kbd>{"G"}</Kbd>
            <Kbd>{n.shortcut.toUpperCase()}</Kbd>
          </span>,
          tn(n.key),
        ] as [React.ReactNode, string],
    ),
    [<Kbd key="esc">{"Esc"}</Kbd>, t("close")],
    [<Kbd key="q">{"?"}</Kbd>, t("help")],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y">
          {rows.map(([keys, label], i) => (
            <div key={i} className="flex items-center justify-between py-2 text-sm">
              <dt>{label}</dt>
              <dd>{keys}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
