"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookOpenTextIcon, BuildingIcon, CornerDownLeftIcon, FlagIcon, FlaskConicalIcon, FolderKanbanIcon, ListTodoIcon, LoaderCircleIcon, ScaleIcon, SearchIcon, TargetIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { searchScale, type SearchHit } from "../server/actions";
import { SCALE_NAV } from "./nav";
import { Kbd } from "./primitives";
import { usePanel } from "./store";

const ICONS: Record<SearchHit["type"], React.ComponentType<{ className?: string }>> = {
  project: FolderKanbanIcon,
  task: ListTodoIcon,
  test: FlaskConicalIcon,
  document: BookOpenTextIcon,
  objective: TargetIcon,
  decision: ScaleIcon,
  milestone: FlagIcon,
  company: BuildingIcon,
};

/** Search across Scale (our team's records only) and the customer companies' names. */
export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("scale.search");
  const tn = useTranslations("scale.nav");
  const router = useRouter();
  const panel = usePanel();
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const list = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- a fresh search each time the dialog opens */
    setQuery("");
    setHits([]);
    setActive(0);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      const res = await searchScale(q).catch(() => null);
      if (cancelled) return;
      setLoading(false);
      if (res?.ok) {
        setHits(res.data);
        setActive(0);
      } else setFailed(true);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const shortcuts = SCALE_NAV.map((n) => ({ key: n.key, href: n.href, icon: n.icon, label: tn(n.key) }));
  const showingShortcuts = query.trim().length < 2;
  const count = showingShortcuts ? shortcuts.length : hits.length;

  function go(i: number) {
    onOpenChange(false);
    if (showingShortcuts) {
      router.push(shortcuts[i].href);
      return;
    }
    const h = hits[i];
    if (!h) return;
    if (h.type === "project") router.push(`/scale/projects/${h.id}`);
    else if (h.type === "test") router.push(`/scale/tests/${h.id}`);
    else if (h.type === "document") router.push(`/scale/strategy/${h.id}`);
    else panel.open(h.type, h.id);
  }

  React.useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
        >
          <DialogPrimitive.Title className="sr-only">{t("title")}</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b px-4">
            {loading ? <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" /> : <SearchIcon className="size-4 text-muted-foreground" />}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("placeholder")}
              aria-label={t("title")}
              role="combobox"
              aria-expanded
              aria-controls="scale-search-results"
              aria-activedescendant={count ? `scale-hit-${active}` : undefined}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  if (count) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (count) go(active);
                }
              }}
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <Kbd>{"Esc"}</Kbd>
          </div>
          <ul ref={list} id="scale-search-results" role="listbox" aria-label={t("results")} className="max-h-[50vh] overflow-y-auto p-1.5">
            {showingShortcuts ? <li className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("goTo")}</li> : null}
            {showingShortcuts
              ? shortcuts.map((s, i) => (
                  <Row key={s.key} index={i} active={active === i} onHover={setActive} onPick={go} icon={s.icon} title={s.label} />
                ))
              : hits.map((h, i) => (
                  <Row key={`${h.type}-${h.id}`} index={i} active={active === i} onHover={setActive} onPick={go} icon={ICONS[h.type]} title={h.title} detail={h.detail} tag={`${t(`types.${h.type}`)}${h.archived ? ` · ${t("archived")}` : ""}`} />
                ))}
            {!showingShortcuts && !loading && !failed && hits.length === 0 ? <li className="px-3 py-8 text-center text-sm text-muted-foreground">{t("empty", { query: query.trim() })}</li> : null}
            {failed ? <li className="px-3 py-8 text-center text-sm text-destructive">{t("failed")}</li> : null}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Row({
  index,
  active,
  onHover,
  onPick,
  icon: Icon,
  title,
  detail,
  tag,
}: {
  index: number;
  active: boolean;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail?: string | null;
  tag?: string;
}) {
  return (
    <li
      id={`scale-hit-${index}`}
      role="option"
      aria-selected={active}
      data-index={index}
      onMouseMove={() => onHover(index)}
      onClick={() => onPick(index)}
      className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", active && "bg-accent")}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {tag ? <span className="shrink-0 text-[11px] text-muted-foreground">{tag}</span> : null}
      {active ? <CornerDownLeftIcon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
    </li>
  );
}
