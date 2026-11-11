"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  ActivityIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  BuildingIcon,
  ChevronLeftIcon,
  ChevronsUpDownIcon,
  CpuIcon,
  EyeOffIcon,
  GaugeIcon,
  HeartPulseIcon,
  HouseIcon,
  KeyRoundIcon,
  LanguagesIcon,
  SunMoonIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  BriefcaseIcon,
  ArrowLeftIcon,
  SquarePenIcon,
  RocketIcon,
  MonitorCheckIcon,
  WrenchIcon,
  LayoutGridIcon,
  PanelsTopLeftIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { Logo } from "@/components/brand/logo";
import { useAppearance } from "@/components/appearance/appearance-provider";
import { setLocale } from "@/modules/identity/server/actions";
import { cn } from "@/lib/utils";
import { APPEARANCE_COOKIE_MAX_AGE, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COOKIE } from "@/lib/theme";

const ICONS = {
  home: HouseIcon,
  chat: MessageSquareIcon,
  clients: BriefcaseIcon,
  memory: BrainIcon,
  library: BookOpenIcon,
  apps: LayoutGridIcon,
  profile: UserIcon,
  overview: LayoutDashboardIcon,
  members: UsersIcon,
  company: BuildingIcon,
  activity: ActivityIcon,
  models: CpuIcon,
  agents: BotIcon,
  hide: EyeOffIcon,
  usage: GaugeIcon,
  quotas: WalletIcon,
  permissions: KeyRoundIcon,
  plans: LayersIcon,
  companies: BuildingIcon,
  audit: ScrollTextIcon,
  health: HeartPulseIcon,
  settings: SettingsIcon,
  shield: ShieldIcon,
  back: ArrowLeftIcon,
  newChat: SquarePenIcon,
  releases: RocketIcon,
  preview: MonitorCheckIcon,
  debug: WrenchIcon,
  console: PanelsTopLeftIcon,
  scale: TrendingUpIcon,
} as const;

export type IconName = keyof typeof ICONS;

export type NavItem = { href: string; label: string; icon: IconName; soon?: boolean; exact?: boolean };
export type NavSection = { label?: string; items: NavItem[] };
export type MenuLink = { href: string; label: string; icon: IconName };

export type ShellLabels = {
  comingSoon: string;
  openMenu: string;
  navigation: string;
  language: string;
  signOut: string;
  french: string;
  english: string;
  appearance: string;
  themeDark: string;
  themeLight: string;
  themeSystem: string;
  collapseSidebar: string;
  expandSidebar: string;
  resizeSidebar: string;
  /** "Version v1.2": the version running, shown at the bottom of the account menu. */
  version: string;
};

type ShellProps = {
  sections: NavSection[];
  context: { title: string; subtitle?: string };
  user: { name: string | null; email: string; avatarUrl: string | null };
  menuLinks: MenuLink[];
  locale: "fr" | "en";
  labels: ShellLabels;
  footerLink?: MenuLink;
  /** Extra sidebar content below the navigation (e.g. recent conversations); `rail:` classes adapt it to the rail. */
  sidebarExtra?: React.ReactNode;
  /** Where the account menu's "Appearance" leads (the profile, or our console's own page). */
  appearanceHref?: string;
  /** Our console only: the Workspace | Studio switch, under the logo (the same place as in Studio). */
  spaceSwitch?: React.ReactNode;
  children: React.ReactNode;
};

export function AppShell(props: ShellProps) {
  const [open, setOpen] = React.useState(false);
  const { sidebar, setSidebar } = useAppearance();
  const collapsed = sidebar === "collapsed";
  const asideRef = React.useRef<HTMLElement>(null);
  const columnRef = React.useRef<HTMLDivElement>(null);

  /**
   * Collapse or expand without making the page lay itself out on every frame: the page takes its new
   * place once, then slides there (a transform, done by the graphics chip) while the panel's own
   * width animates on its own layer.
   */
  const toggle = () => {
    const column = columnRef.current;
    const aside = asideRef.current;
    const before = column?.getBoundingClientRect().left ?? 0;
    aside?.setAttribute("data-animating", "");
    setSidebar(collapsed ? "expanded" : "collapsed");
    const after = column?.getBoundingClientRect().left ?? 0;
    const settle = () => aside?.removeAttribute("data-animating");
    if (!column || before === after || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.setTimeout(settle, 320);
      return;
    }
    column.style.transition = "none";
    column.style.transform = `translate3d(${before - after}px, 0, 0)`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        column.style.transition = "transform var(--dur-layout) var(--ease-standard)";
        column.style.transform = "";
      }),
    );
    // In any case, at rest after the slide (even if a busy device skipped frames).
    window.setTimeout(() => {
      column.style.transition = "";
      column.style.transform = "";
      settle();
    }, 340);
  };

  return (
    <div className="flex min-h-dvh">
      {/* Desktop: a floating glass panel; collapsed, a narrow rail of icons (widths in appearance.css). */}
      <aside ref={asideRef} data-shell-sidebar className="shell-sidebar sticky top-0 hidden h-dvh shrink-0 md:block">
        <div className="shell-panel-frame">
          <LiquidGlass material="panel" reach={56} className="flex h-full flex-col overflow-hidden rounded-[22px]">
            <SidebarBody {...props} rail={collapsed} />
          </LiquidGlass>
          {collapsed ? null : <SidebarResizer label={props.labels.resizeSidebar} aside={asideRef} />}
          {/* Centred on the line under the page header (56 px from the top). */}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? props.labels.expandSidebar : props.labels.collapseSidebar}
            aria-expanded={!collapsed}
            className="absolute -right-3 top-[34px] z-10 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_14px_-4px_var(--glass-shadow-color),0_0_0_1px_var(--glass-ring)] transition-transform duration-[var(--dur-micro)] hover:scale-110 active:scale-95"
          >
            <ChevronLeftIcon className={cn("size-3.5 transition-transform duration-[var(--dur-layout)]", collapsed && "rotate-180")} />
          </button>
        </div>
      </aside>

      <div ref={columnRef} className="flex min-w-0 flex-1 flex-col">
        <LiquidGlass material="panel" reach={14} className="sticky top-0 z-30 flex h-14 items-center gap-3 rounded-none border-b px-4 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={props.labels.openMenu}>
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent title={props.labels.navigation}>
              {/* Close the mobile menu as soon as a link is followed. */}
              <div className="contents" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
                <SidebarBody {...props} rail={false} />
              </div>
            </SheetContent>
          </Sheet>
          <Logo />
        </LiquidGlass>
        <main className={cn("flex-1", props.spaceSwitch && "animate-space-in")}>{props.children}</main>
      </div>
    </div>
  );
}

function SidebarBody({ sections, context, user, menuLinks, locale, labels, footerLink, sidebarExtra, appearanceHref, spaceSwitch, rail }: ShellProps & { rail: boolean }) {
  const pathname = usePathname();
  const navRef = React.useRef<HTMLElement>(null);
  const lens = useSelectionLens(navRef, `${pathname}|${rail}`);
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4 rail:justify-center rail:px-0">
        <Logo className="rail:[&>span:last-child]:sr-only" />
      </div>
      {spaceSwitch ? <div className="pb-4 rail:hidden">{spaceSwitch}</div> : null}
      <div className="px-4 pb-2 rail:hidden">
        <p className="truncate text-[13px] font-medium">{context.title}</p>
        {context.subtitle ? <p className="truncate text-xs text-muted-foreground">{context.subtitle}</p> : null}
      </div>

      <nav
        ref={navRef}
        data-lens-ready={lens ? "" : undefined}
        className="shell-nav relative min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-2.5 py-2 rail:px-0"
        aria-label={labels.navigation}
      >
        {/* A drop of Liquid Glass that slides to the page you are on, under the row (the label stays crisp). */}
        <LiquidGlass
          aria-hidden
          material="lens"
          reach={8}
          data-lifted={lens?.lifted ? "" : undefined}
          className="shell-lens pointer-events-none absolute left-0 top-0 z-0 !m-0 rounded-[11px]"
          style={
            lens
              ? { transform: `translate(${lens.x}px, ${lens.y}px) scale(${lens.lifted ? 1.045 : 1})`, width: lens.w, height: lens.h }
              : { opacity: 0, width: 36, height: 36 }
          }
        />
        {sections.map((section, i) => (
          <div key={i} className="space-y-0.5">
            {section.label ? (
              <>
                <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75 rail:hidden">
                  {section.label}
                </p>
                {i > 0 ? <div aria-hidden className="mx-auto mb-2 hidden h-px w-6 bg-border rail:block" /> : null}
              </>
            ) : null}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} soonLabel={labels.comingSoon} rail={rail} />
            ))}
          </div>
        ))}
        {/* Each extra section shows its own icon in the rail (clients, search) and hides its lists. */}
        {sidebarExtra}
      </nav>

      {footerLink ? (
        <div className="px-2.5 pb-1 rail:px-0">
          <NavLink item={{ ...footerLink, exact: true }} pathname={pathname} soonLabel={labels.comingSoon} rail={rail} />
        </div>
      ) : null}

      <div className="mx-2.5 border-t border-[var(--glass-border)] py-2 rail:mx-2">
        <UserMenu user={user} menuLinks={menuLinks} locale={locale} labels={labels} appearanceHref={appearanceHref} />
      </div>
    </div>
  );
}

function NavLink({ item, pathname, soonLabel, rail }: { item: NavItem; pathname: string; soonLabel: string; rail: boolean }) {
  const Icon = ICONS[item.icon];
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
  const base =
    "flex h-9 items-center gap-2.5 rounded-[11px] px-2.5 text-[13.5px] rail:mx-auto rail:size-10 rail:justify-center rail:gap-0 rail:px-0";

  if (item.soon) {
    return (
      <span className={cn(base, "cursor-default text-muted-foreground/70")} aria-disabled>
        <Icon className="size-[17px] shrink-0" />
        <span className="flex-1 truncate rail:sr-only">{item.label}</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] rail:hidden">
          {soonLabel}
        </Badge>
      </span>
    );
  }

  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        "glass-interactive",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("size-[17px] shrink-0 transition-colors duration-[var(--dur-micro)]", active && "text-brand")} />
      <span className="truncate rail:sr-only">{item.label}</span>
    </Link>
  );
  // In the rail, each icon names its page on hover or focus.
  return rail ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/**
 * Where the selection lens sits: over the visible row marked as the current page (navigation, a
 * client, a conversation), measured inside the scrolling navigation. It is also Liquid Glass you can
 * hold: press a row and the lens lifts onto it; keep pressing and slide across rows, and it follows;
 * let go and it settles there while the page opens. Follows route changes, the rail, lists that load
 * later, and size changes.
 */
function useSelectionLens(navRef: React.RefObject<HTMLElement | null>, key: string) {
  const [box, setBox] = React.useState<{ x: number; y: number; w: number; h: number; lifted: boolean } | null>(null);
  React.useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let frame = 0;
    let pressed = false;
    // The row the lens was let go on, kept until the page it opens marks it current (or 1.5 s).
    let pinned: HTMLElement | null = null;
    let pinTimer = 0;

    const place = (el: HTMLElement | null, lifted: boolean) => {
      if (!el) return setBox(null);
      const a = nav.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const next = { x: b.left - a.left + nav.scrollLeft, y: b.top - a.top + nav.scrollTop, w: b.width, h: b.height, lifted };
      setBox((prev) =>
        prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h && prev.lifted === next.lifted ? prev : next,
      );
    };
    const current = () => [...nav.querySelectorAll<HTMLElement>('[aria-current="page"]')].find((el) => el.offsetParent !== null) ?? null;
    const measure = () => {
      if (pressed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const now = current();
        if (pinned && now !== pinned && pinned.isConnected) return place(pinned, false);
        pinned = null;
        place(now, false);
      });
    };
    const rowAt = (target: EventTarget | null) => {
      const row = (target as Element | null)?.closest?.<HTMLElement>(".glass-interactive");
      return row && nav.contains(row) && row.offsetParent !== null ? row : null;
    };

    let downRow: HTMLElement | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const row = rowAt(e.target);
      if (!row) return;
      pressed = true;
      downRow = row;
      place(row, true);
    };
    const onMove = (e: PointerEvent) => {
      if (!pressed) return;
      const row = rowAt(document.elementFromPoint(e.clientX, e.clientY));
      if (row) place(row, true);
    };
    const onUp = (e: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      const row = e.type === "pointercancel" ? null : rowAt(document.elementFromPoint(e.clientX, e.clientY));
      // Let go on another row than the one pressed: open that one (the browser only clicks when
      // press and release land on the same element).
      if (row && downRow && row !== downRow) row.click();
      downRow = null;
      if (row && row.matches("a[href]")) {
        pinned = row;
        window.clearTimeout(pinTimer);
        pinTimer = window.setTimeout(() => {
          pinned = null;
          measure();
        }, 1500);
        place(row, false);
      } else {
        measure();
      }
    };

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(nav);
    const mutations = new MutationObserver(measure);
    mutations.observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current"] });
    nav.addEventListener("transitionend", measure);
    nav.addEventListener("pointerdown", onDown);
    // Rows are not dragged out as links: pressing and sliding moves the lens instead.
    const noDrag = (e: DragEvent) => e.preventDefault();
    nav.addEventListener("dragstart", noDrag);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(pinTimer);
      resize.disconnect();
      mutations.disconnect();
      nav.removeEventListener("transitionend", measure);
      nav.removeEventListener("pointerdown", onDown);
      nav.removeEventListener("dragstart", noDrag);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [navRef, key]);
  return box;
}

function UserMenu({
  user,
  menuLinks,
  locale,
  labels,
  appearanceHref = "/profile#appearance",
}: Pick<ShellProps, "user" | "menuLinks" | "locale" | "labels" | "appearanceHref">) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="glass-interactive flex w-full items-center gap-2.5 rounded-[12px] p-1.5 text-left rail:justify-center">
          <Avatar name={user.name ?? user.email} src={user.avatarUrl} className="size-8 ring-2 ring-[var(--glass-border)]" />
          <span className="min-w-0 flex-1 rail:sr-only">
            <span className="block truncate text-[13px] font-medium">{user.name ?? user.email}</span>
            {user.name ? <span className="block truncate text-xs text-muted-foreground">{user.email}</span> : null}
          </span>
          <ChevronsUpDownIcon className="size-4 text-muted-foreground rail:hidden" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        {menuLinks.map((link) => {
          const Icon = ICONS[link.icon];
          return (
            <DropdownMenuItem key={link.href} asChild>
              <Link href={link.href}>
                <Icon />
                {link.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem asChild>
          <Link href={appearanceHref}>
            <SunMoonIcon />
            {labels.appearance}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <LanguagesIcon className="size-3.5" />
          {labels.language}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => startTransition(() => setLocale(value))}
        >
          <DropdownMenuRadioItem value="fr" disabled={pending}>
            {labels.french}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en" disabled={pending}>
            {labels.english}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOutIcon />
              {labels.signOut}
            </button>
          </DropdownMenuItem>
        </form>
        <p className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground/80" data-testid="app-version">
          {labels.version}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The expanded sidebar's right edge: drag it to make the menu wider or narrower (224–420 px), or use
 * ← → when it has the focus; a double-click (or Home) restores the default width. The width is set
 * on the page directly while dragging (no redraw of the app) and kept in a cookie, so the next visit
 * opens at the same width before the first paint.
 */
function SidebarResizer({ label, aside }: { label: string; aside: React.RefObject<HTMLElement | null> }) {
  const drag = React.useRef<{ x: number; width: number } | null>(null);
  const current = () => aside.current?.getBoundingClientRect().width ?? SIDEBAR_WIDTH.default;
  const apply = (width: number | null) => {
    const root = document.documentElement;
    if (width === null) {
      root.style.removeProperty("--sidebar-expanded-w");
      document.cookie = `${SIDEBAR_WIDTH_COOKIE}=; path=/; max-age=0; samesite=lax`;
      return;
    }
    const w = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));
    root.style.setProperty("--sidebar-expanded-w", `${w}px`);
    return w;
  };
  const save = (w: number | undefined) => {
    if (w) document.cookie = `${SIDEBAR_WIDTH_COOKIE}=${w}; path=/; max-age=${APPEARANCE_COOKIE_MAX_AGE}; samesite=lax`;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width: current() };
        aside.current?.setAttribute("data-resizing", "");
      }}
      onPointerMove={(e) => {
        if (drag.current) apply(drag.current.width + (e.clientX - drag.current.x));
      }}
      onPointerUp={() => {
        drag.current = null;
        aside.current?.removeAttribute("data-resizing");
        save(apply(current()));
      }}
      onPointerCancel={() => {
        drag.current = null;
        aside.current?.removeAttribute("data-resizing");
      }}
      onDoubleClick={() => apply(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          save(apply(current() + (e.key === "ArrowRight" ? 16 : -16)));
        } else if (e.key === "Home") {
          e.preventDefault();
          apply(null);
        }
      }}
      className="shell-resizer absolute inset-y-6 -right-1.5 z-[5] w-3 cursor-col-resize touch-none rounded-full outline-none"
    />
  );
}

