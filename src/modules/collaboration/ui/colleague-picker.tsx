"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { matchesSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { Colleague } from "../server/queries";

/** Shown at once; more matches ask for a more precise search (large companies stay fast). */
const SHOWN = 80;

/**
 * "Qui ?": a searchable list of colleagues (name or e-mail, accents and case ignored), several can be
 * chosen, each once. Keyboard: ↑ ↓ to move, Entrée to pick or remove, Échap to close the list.
 */
export function ColleaguePicker({
  colleagues,
  selected,
  onChange,
  label,
}: {
  colleagues: Colleague[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  label: string;
}) {
  const t = useTranslations("collaboration");
  const id = React.useId();
  const listId = `${id}-list`;
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  const list = React.useRef<HTMLUListElement>(null);
  const root = React.useRef<HTMLDivElement>(null);

  const matches = React.useMemo(() => colleagues.filter((c) => matchesSearch(query, c.name, c.email, c.expertise.join(" "))), [colleagues, query]);
  const shown = matches.slice(0, SHOWN);
  const chosen = colleagues.filter((c) => selected.has(c.userId));

  const toggle = (userId: string) => {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange(next);
  };

  React.useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  // Échap closes the list first. The dialog listens for it before any element does, so the list
  // catches it on the window, earlier; a second Échap then closes the dialog.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !root.current?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (shown.length) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % shown.length : (a - 1 + shown.length) % shown.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = shown[active];
      if (open && c) toggle(c.userId);
      else setOpen(true);
    } else if (e.key === "Backspace" && !query && chosen.length) {
      toggle(chosen[chosen.length - 1].userId);
    }
  };

  return (
    <div
      ref={root}
      className="space-y-2"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-background/40 px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30",
        )}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            input.current?.focus();
            setOpen(true);
          }
        }}
      >
        {chosen.map((c) => (
          <span key={c.userId} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent py-0.5 pl-0.5 pr-1.5 text-[13px]">
            <Avatar name={c.name} src={c.avatarUrl} className="size-5 text-[9px]" />
            <span className="truncate">{c.name}</span>
            <button type="button" onClick={() => toggle(c.userId)} aria-label={t("whoRemove", { name: c.name })} className="rounded-full p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground">
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <span className="flex min-w-[10rem] flex-1 items-center gap-1.5">
          <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && shown[active] ? `${id}-${shown[active].userId}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={chosen.length ? t("whoMorePlaceholder") : t("whoPlaceholder")}
            autoComplete="off"
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </span>
      </div>
      {open ? (
        <div className="overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-sm">
          <ul ref={list} id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-60 overflow-y-auto p-1">
            {shown.map((c, i) => {
              const on = selected.has(c.userId);
              return (
                <li
                  key={c.userId}
                  id={`${id}-${c.userId}`}
                  role="option"
                  aria-selected={on}
                  data-index={i}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => toggle(c.userId)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5", i === active && "bg-accent")}
                >
                  <Avatar name={c.name} src={c.avatarUrl} className="size-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.expertise.length ? c.expertise.join(", ") : c.email}</span>
                  </span>
                  <CheckIcon aria-hidden className={cn("size-4 shrink-0", on ? "text-foreground" : "invisible")} />
                </li>
              );
            })}
          </ul>
          {matches.length === 0 ? <p className="px-3 py-4 text-center text-[13px] text-muted-foreground">{t("whoEmpty", { query })}</p> : null}
          {matches.length > SHOWN ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("whoNarrow", { count: matches.length - SHOWN })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
