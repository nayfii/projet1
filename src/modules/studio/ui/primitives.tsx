"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  BookIcon,
  BoxIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CompassIcon,
  FolderIcon,
  HandshakeIcon,
  HeartIcon,
  LightbulbIcon,
  MegaphoneIcon,
  RocketIcon,
  SettingsIcon,
  ShieldIcon,
  StarIcon,
  TargetIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { todayIso } from "../logic/dates";
import { PRIORITIES, TASK_STATUSES, type Category, type CategoryIcon as CategoryIconName, type Priority, type TaskStatus } from "../types";

/**
 * Studio's small controls. Colours carry meaning only next to a label or an icon, and stay discreet
 * (the design system's soft tones; neutral in Glass Clear).
 */

/** "YYYY-MM-DD" shown as a date, read at noon UTC so the day is the same in every time zone. */
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function useDates() {
  const format = useFormatter();
  return React.useMemo(
    () => ({
      short: (iso: string) => format.dateTime(isoToDate(iso), { day: "numeric", month: "short" }),
      long: (iso: string) => format.dateTime(isoToDate(iso), { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
      monthYear: (iso: string) => format.dateTime(isoToDate(iso), { month: "long", year: "numeric" }),
      weekday: (iso: string) => format.dateTime(isoToDate(iso), { weekday: "short" }),
      relative: (ts: string) => format.relativeTime(new Date(ts), new Date()),
      number: (n: number, digits = 1) => format.number(n, { maximumFractionDigits: digits }),
      money: (n: number, currency = "EUR") => format.number(n, { style: "currency", currency, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }),
      percent: (ratio: number) => format.number(ratio, { style: "percent", maximumFractionDigits: 0 }),
    }),
    [format],
  );
}

// ─── Priority, status ───────────────────────────────────────────────────────

const PRIORITY_DOT: Record<Priority, string> = {
  high: "bg-destructive/80",
  medium: "bg-warning/80",
  low: "bg-muted-foreground/35",
};

/** A small dot: red for high, amber for medium, grey for low (always next to a label or a tooltip). */
export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  const t = useTranslations("studio.priority");
  return <span role="img" aria-label={t(priority)} title={t(priority)} className={cn("inline-block size-2 shrink-0 rounded-full", PRIORITY_DOT[priority], className)} />;
}

export function PriorityMenu({ value, onChange, className }: { value: Priority; onChange: (v: Priority) => void; className?: string }) {
  const t = useTranslations("studio.priority");
  return (
    <ChoiceMenu
      value={value}
      options={PRIORITIES}
      label={(p) => t(p)}
      onChange={(p) => p && onChange(p)}
      ariaLabel={t("label")}
      className={className}
      render={(p) => (
        <span className="inline-flex items-center gap-2">
          <PriorityDot priority={p ?? "medium"} />
          {t(p ?? "medium")}
        </span>
      )}
      itemIcon={(p) => <PriorityDot priority={p} />}
    />
  );
}

const STATUS_ICON: Record<TaskStatus, React.ComponentType<{ className?: string }>> = { todo: CircleIcon, in_progress: CircleDotIcon, done: CircleCheckIcon };
const STATUS_TONE: Record<TaskStatus, string> = { todo: "text-muted-foreground", in_progress: "text-warning", done: "text-success" };

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return <Icon aria-hidden className={cn("size-4 shrink-0", STATUS_TONE[status], className)} />;
}

export function StatusMenu({ value, onChange, className }: { value: TaskStatus; onChange: (v: TaskStatus) => void; className?: string }) {
  const t = useTranslations("studio.status");
  return (
    <ChoiceMenu
      value={value}
      options={TASK_STATUSES}
      label={(v) => t(v)}
      onChange={(v) => v && onChange(v)}
      ariaLabel={t("label")}
      className={className}
      render={(v) => (
        <span className="inline-flex items-center gap-2">
          <StatusIcon status={v ?? "todo"} />
          {t(v ?? "todo")}
        </span>
      )}
      itemIcon={(v) => <StatusIcon status={v} />}
    />
  );
}

// ─── Categories ─────────────────────────────────────────────────────────────

export const CATEGORY_ICON: Record<CategoryIconName, React.ComponentType<{ className?: string }>> = {
  compass: CompassIcon,
  box: BoxIcon,
  megaphone: MegaphoneIcon,
  "trending-up": TrendingUpIcon,
  handshake: HandshakeIcon,
  wallet: WalletIcon,
  settings: SettingsIcon,
  shield: ShieldIcon,
  folder: FolderIcon,
  book: BookIcon,
  lightbulb: LightbulbIcon,
  users: UsersIcon,
  target: TargetIcon,
  rocket: RocketIcon,
  heart: HeartIcon,
  star: StarIcon,
};

export function CategoryGlyph({ icon, className }: { icon: string; className?: string }) {
  const Icon = CATEGORY_ICON[icon as CategoryIconName] ?? FolderIcon;
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}

/** A category's name: its own once renamed, otherwise the starting name in the reader's language. */
export function useCategoryName() {
  const t = useTranslations("studio.categories");
  return React.useCallback((c: Pick<Category, "key" | "name"> | null | undefined) => (c ? (c.name ?? (c.key ? t(c.key as Parameters<typeof t>[0]) : "")) : t("none")), [t]);
}

export function CategoryMenu({
  value,
  categories,
  onChange,
  className,
}: {
  value: string | null;
  categories: Category[];
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const t = useTranslations("studio.categories");
  const name = useCategoryName();
  const current = categories.find((c) => c.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        onClick={(e) => e.stopPropagation()}
        className={cn("inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        {current ? <CategoryGlyph icon={current.icon} className="size-3.5 text-muted-foreground" /> : null}
        <span className={cn("truncate", !current && "text-muted-foreground")}>{current ? name(current) : t("none")}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {categories.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => onChange(c.id)}>
            <CategoryGlyph icon={c.icon} className="text-muted-foreground" />
            <span className="flex-1 truncate">{name(c)}</span>
            {c.id === value ? <CheckIcon /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <span className="flex-1 text-muted-foreground">{t("none")}</span>
          {value === null ? <CheckIcon /> : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Today in our time zone; refreshed when the tab comes back after midnight. */
export function useToday(): string {
  return React.useSyncExternalStore(subscribeToFocus, () => todayIso(), () => todayIso());
}
function subscribeToFocus(onChange: () => void) {
  window.addEventListener("focus", onChange);
  return () => window.removeEventListener("focus", onChange);
}

export function ChoiceMenu<T extends string>({
  value,
  options,
  label,
  onChange,
  render,
  allowNone,
  noneLabel,
  className,
  ariaLabel,
  itemIcon,
}: {
  value: T | null;
  options: readonly T[];
  label: (v: T) => string;
  onChange: (v: T | null) => void;
  render?: (v: T | null) => React.ReactNode;
  itemIcon?: (v: T) => React.ReactNode;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        {render ? render(value) : <span className={cn(!value && "text-muted-foreground")}>{value ? label(value) : noneLabel}</span>}
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {options.map((o) => (
          <DropdownMenuItem key={o} onSelect={() => onChange(o)}>
            {itemIcon?.(o)}
            <span className="flex-1">{label(o)}</span>
            {o === value ? <CheckIcon /> : null}
          </DropdownMenuItem>
        ))}
        {allowNone ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)}>
              <span className="flex-1 text-muted-foreground">{noneLabel}</span>
              {value === null ? <CheckIcon /> : null}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pick one record (project, milestone, objective, test…) or none. */
export function RecordMenu({
  value,
  items,
  onChange,
  noneLabel,
  ariaLabel,
  icon,
  className,
}: {
  value: string | null;
  items: { id: string; label: string; hint?: string }[];
  onChange: (id: string | null) => void;
  noneLabel: string;
  ariaLabel: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  const current = items.find((i) => i.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={cn("inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        {icon}
        <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.label ?? noneLabel}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <span className="flex-1 text-muted-foreground">{noneLabel}</span>
          {value === null ? <CheckIcon /> : null}
        </DropdownMenuItem>
        {items.length ? <DropdownMenuSeparator /> : null}
        {items.map((i) => (
          <DropdownMenuItem key={i.id} onSelect={() => onChange(i.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{i.label}</span>
              {i.hint ? <span className="block truncate text-xs text-muted-foreground">{i.hint}</span> : null}
            </span>
            {i.id === value ? <CheckIcon /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Dates ──────────────────────────────────────────────────────────────────

/** A date shown as a chip; a click opens the browser's date picker (keyboard accessible). */
export function DateField({
  value,
  onChange,
  label,
  placeholder,
  tone,
  min,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  placeholder?: string;
  tone?: "overdue" | "soon" | null;
  min?: string | null;
  className?: string;
}) {
  const t = useTranslations("studio.common");
  const dates = useDates();
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <span className={cn("group/date relative inline-flex items-center", className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={value ? `${label} : ${dates.long(value)}` : `${label} : ${placeholder ?? t("noDate")}`}
        onClick={() => {
          const el = input.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        className={cn(
          "inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          tone === "overdue" && "text-destructive",
          tone === "soon" && "text-warning",
          !value && "text-muted-foreground",
        )}
      >
        <CalendarIcon aria-hidden className="size-3.5" />
        {value ? dates.short(value) : (placeholder ?? t("noDate"))}
      </button>
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value ?? ""}
        min={min ?? undefined}
        onChange={(e) => onChange(e.target.value || null)}
        className="pointer-events-none absolute inset-0 opacity-0"
      />
      {value ? (
        <button type="button" aria-label={t("clearDate", { label })} onClick={() => onChange(null)} className="ml-0.5 hidden rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground group-hover/date:inline-flex group-focus-within/date:inline-flex">
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

// ─── Text that saves itself ─────────────────────────────────────────────────

/** One line, edited in place: saved on Enter or when leaving the field, Escape puts it back. */
export function InlineText({
  value,
  onSave,
  className,
  placeholder,
  ariaLabel,
  required = false,
  maxLength = 300,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
  required?: boolean;
  maxLength?: number;
}) {
  const [draft, setDraft] = React.useState(value);
  const [focused, setFocused] = React.useState(false);
  const shown = focused ? draft : value;
  const commit = () => {
    const next = draft.trim();
    if (required && !next) {
      setDraft(value);
      return;
    }
    if (next !== value) onSave(next);
  };
  return (
    <input
      value={shown}
      aria-label={ariaLabel}
      placeholder={placeholder}
      maxLength={maxLength}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
          setFocused(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn("w-full min-w-0 rounded-md bg-transparent px-1 outline-none transition-colors placeholder:text-muted-foreground/70 hover:bg-accent/50 focus:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40", className)}
    />
  );
}

/** Several lines that grow with the text; saved a moment after typing stops, and when leaving. */
export function AutoText({
  value,
  onSave,
  placeholder,
  ariaLabel,
  className,
  maxLength = 20000,
  minRows = 2,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  maxLength?: number;
  minRows?: number;
}) {
  const [draft, setDraft] = React.useState(value ?? "");
  const [focused, setFocused] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = React.useRef(value ?? "");
  const shown = focused ? draft : (value ?? "");

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [shown]);

  const flush = React.useCallback(
    (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (text === lastSaved.current) return;
      lastSaved.current = text;
      onSave(text.trim() ? text : null);
    },
    [onSave],
  );

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={shown}
      aria-label={ariaLabel}
      placeholder={placeholder}
      maxLength={maxLength}
      onFocus={() => {
        setDraft(value ?? "");
        lastSaved.current = value ?? "";
        setFocused(true);
      }}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(text), 900);
      }}
      onBlur={() => {
        flush(draft);
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className={cn(
        "w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-border focus:border-ring focus:bg-card focus-visible:ring-3 focus-visible:ring-ring/15",
        className,
      )}
    />
  );
}

// ─── Layout helpers ─────────────────────────────────────────────────────────

export function ProgressBar({ ratio, label, tone = "default", className }: { ratio: number | null; label: string; tone?: "default" | "success"; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {ratio !== null ? <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone === "success" ? "bg-success" : "bg-foreground/70")} style={{ width: ratio > 0 ? `${Math.max(2, Math.round(ratio * 100))}%` : "0%" }} /> : null}
    </div>
  );
}

/** A label above its value, for panels and pages. */
export function Field({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <div className={cn("grid grid-cols-[8.5rem_1fr] items-start gap-x-3 gap-y-1 py-1 max-sm:grid-cols-1", className)}>
      <span className="pt-1.5 text-[13px] text-muted-foreground">
        {label}
        {hint ? <span className="block text-[11px] leading-snug text-muted-foreground/70">{hint}</span> : null}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SectionTitle({ children, action, className, id }: { children: React.ReactNode; action?: React.ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 id={id} className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground">{children}</kbd>;
}

/** Segmented control (views, tabs): arrow keys move between options. */
export function Segmented<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void; label: string; className?: string }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border bg-muted/50 p-0.5", className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next = (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
              onChange(options[next].value);
              refs.current[next]?.focus();
            }}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
              active ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A page's title block. */
export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** An empty section: a short explanation and the obvious next step. */
export function EmptyNote({ icon, title, body, action, className }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center animate-message-in", className)}>
      {icon ? <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

