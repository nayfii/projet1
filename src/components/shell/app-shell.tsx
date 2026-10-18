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
  ChevronsUpDownIcon,
  CpuIcon,
  EyeOffIcon,
  GaugeIcon,
  HeartPulseIcon,
  HouseIcon,
  KeyRoundIcon,
  LanguagesIcon,
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
import { Logo } from "@/components/brand/logo";
import { setLocale } from "@/modules/identity/server/actions";
import { cn } from "@/lib/utils";

const ICONS = {
  home: HouseIcon,
  chat: MessageSquareIcon,
  clients: BriefcaseIcon,
  memory: BrainIcon,
  library: BookOpenIcon,
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
};

type ShellProps = {
  sections: NavSection[];
  context: { title: string; subtitle?: string };
  user: { name: string | null; email: string; avatarUrl: string | null };
  menuLinks: MenuLink[];
  locale: "fr" | "en";
  labels: ShellLabels;
  footerLink?: MenuLink;
  children: React.ReactNode;
};

export function AppShell(props: ShellProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarBody {...props} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={props.labels.openMenu}>
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent title={props.labels.navigation}>
              {/* Close the mobile menu as soon as a link is followed. */}
              <div className="contents" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
                <SidebarBody {...props} />
              </div>
            </SheetContent>
          </Sheet>
          <Logo />
        </div>
        <main className="flex-1">{props.children}</main>
      </div>
    </div>
  );
}

function SidebarBody({ sections, context, user, menuLinks, locale, labels, footerLink }: ShellProps) {
  const pathname = usePathname();
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>
      <div className="px-4 pb-3">
        <p className="truncate text-[13px] font-medium">{context.title}</p>
        {context.subtitle ? <p className="truncate text-xs text-muted-foreground">{context.subtitle}</p> : null}
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-2" aria-label={labels.navigation}>
        {sections.map((section, i) => (
          <div key={i} className="space-y-0.5">
            {section.label ? (
              <p className="px-2 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                {section.label}
              </p>
            ) : null}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} soonLabel={labels.comingSoon} />
            ))}
          </div>
        ))}
      </nav>

      {footerLink ? (
        <div className="px-2 pb-1">
          <NavLink item={{ ...footerLink, exact: true }} pathname={pathname} soonLabel={labels.comingSoon} />
        </div>
      ) : null}

      <div className="border-t border-sidebar-border p-2">
        <UserMenu user={user} menuLinks={menuLinks} locale={locale} labels={labels} />
      </div>
    </div>
  );
}

function NavLink({ item, pathname, soonLabel }: { item: NavItem; pathname: string; soonLabel: string }) {
  const Icon = ICONS[item.icon];
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
  const base = "flex h-[30px] items-center gap-2.5 rounded-md px-2 text-sm transition-colors";

  if (item.soon) {
    return (
      <span className={cn(base, "cursor-default text-muted-foreground/70")} aria-disabled>
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          {soonLabel}
        </Badge>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        active
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-brand")} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function UserMenu({
  user,
  menuLinks,
  locale,
  labels,
}: Pick<ShellProps, "user" | "menuLinks" | "locale" | "labels">) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sidebar-accent">
          <Avatar name={user.name ?? user.email} src={user.avatarUrl} className="size-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{user.name ?? user.email}</span>
            {user.name ? <span className="block truncate text-xs text-muted-foreground">{user.email}</span> : null}
          </span>
          <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
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
        {menuLinks.length > 0 ? <DropdownMenuSeparator /> : null}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
