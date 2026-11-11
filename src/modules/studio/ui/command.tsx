"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRightIcon, BookOpenIcon, CheckSquareIcon, FileTextIcon, FlagIcon, LayoutDashboardIcon, LayoutGridIcon, ListTodoIcon, MapIcon, SearchIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { rank } from "../logic/search";
import { useDocumentSearch } from "./knowledge";
import { Kbd, StatusIcon } from "./primitives";
import { useShell } from "./shell";
import { lastPath } from "./spaces";
import { usePanel, useStudio } from "./store";

type Entry = { key: string; group: "results" | "actions" | "go"; label: string; detail?: string | null; type?: string; icon: React.ReactNode; run: () => void };

/**
 * ⌘K: find a task, a milestone or a document (titles at once, documents' text a moment later),
 * create something, or go to a section. Arrows and Enter, or the mouse.
 */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("studio.command");
  const tc = useTranslations("studio.common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("description")}</DialogDescription>
        {open ? <Palette onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const t = useTranslations("studio.command");
  const tn = useTranslations("studio.nav");
  const data = useStudio();
  const shell = useShell();
  const panel = usePanel();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const { results: docs } = useDocumentSearch(query);
  const q = query.trim();

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const entries: Entry[] = [];
  if (q) {
    for (const r of rank(q, data.tasks.filter((x) => !x.archived_at && x.status !== "cancelled"), (x) => [x.title, x.description], 6)) {
      const x = r.item;
      entries.push({ key: `task:${x.id}`, group: "results", label: x.title, type: t("types.task"), icon: <StatusIcon status={x.status === "cancelled" ? "done" : x.status} />, run: go(() => panel.open("task", x.id)) });
    }
    for (const r of rank(q, data.milestones.filter((m) => !m.archived_at), (m) => [m.title, m.description], 4)) {
      entries.push({ key: `milestone:${r.item.id}`, group: "results", label: r.item.title, type: t("types.milestone"), icon: <FlagIcon className="size-4 text-muted-foreground" />, run: go(() => panel.open("milestone", r.item.id)) });
    }
    for (const d of docs.slice(0, 6)) {
      entries.push({ key: `doc:${d.id}`, group: "results", label: d.title, detail: d.snippet, type: t("types.document"), icon: <FileTextIcon className="size-4 text-muted-foreground" />, run: go(() => router.push(`/studio/knowledge/${d.id}`)) });
    }
  }
  const actions: Entry[] = [
    { key: "new-task", group: "actions", label: t("newTask"), icon: <CheckSquareIcon className="size-4 text-muted-foreground" />, run: go(() => shell.create("task", q ? {} : {})) },
    { key: "new-doc", group: "actions", label: t("newDocument"), icon: <FileTextIcon className="size-4 text-muted-foreground" />, run: go(() => shell.create("document")) },
    { key: "new-milestone", group: "actions", label: t("newMilestone"), icon: <FlagIcon className="size-4 text-muted-foreground" />, run: go(() => shell.create("milestone")) },
  ];
  const nav: Entry[] = [
    { key: "go-overview", group: "go", label: tn("overview"), icon: <LayoutDashboardIcon className="size-4 text-muted-foreground" />, run: go(() => router.push("/studio")) },
    { key: "go-tasks", group: "go", label: tn("tasks"), icon: <ListTodoIcon className="size-4 text-muted-foreground" />, run: go(() => router.push("/studio/tasks")) },
    { key: "go-roadmap", group: "go", label: tn("roadmap"), icon: <MapIcon className="size-4 text-muted-foreground" />, run: go(() => router.push("/studio/roadmap")) },
    { key: "go-knowledge", group: "go", label: tn("knowledge"), icon: <BookOpenIcon className="size-4 text-muted-foreground" />, run: go(() => router.push("/studio/knowledge")) },
    { key: "go-workspace", group: "go", label: t("toWorkspace"), icon: <LayoutGridIcon className="size-4 text-muted-foreground" />, run: go(() => router.push(lastPath("workspace") ?? "/platform")) },
  ];
  const keep = (e: Entry) => !q || rank(q, [e], (x) => [x.label]).length > 0;
  entries.push(...actions.filter(keep), ...nav.filter(keep));
  const current = Math.min(active, Math.max(0, entries.length - 1));
  const groups: Entry["group"][] = ["results", "actions", "go"];

  return (
    <div>
      <div className="flex items-center gap-3 border-b px-4">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((current + (e.key === "ArrowDown" ? 1 : entries.length - 1)) % Math.max(1, entries.length));
            }
            if (e.key === "Enter" && entries[current]) {
              e.preventDefault();
              entries[current].run();
            }
          }}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <Kbd>{"Esc"}</Kbd>
      </div>
      <div role="listbox" aria-label={t("title")} className="max-h-[22rem] overflow-y-auto p-2">
        {q && !entries.some((e) => e.group === "results") ? <p className="px-3 py-3 text-sm text-muted-foreground">{t("noResult")}</p> : null}
        {groups.map((g) => {
          const list = entries.filter((e) => e.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t(`groups.${g}`)}</p>
              {list.map((e) => {
                const i = entries.indexOf(e);
                return (
                  <button
                    key={e.key}
                    type="button"
                    role="option"
                    aria-selected={i === current}
                    onMouseEnter={() => setActive(i)}
                    onClick={e.run}
                    className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", i === current ? "bg-accent" : "hover:bg-accent/50")}
                  >
                    {e.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.label}</span>
                      {e.detail ? <span className="block truncate text-xs text-muted-foreground">{e.detail}</span> : null}
                    </span>
                    {e.type ? <span className="shrink-0 rounded-full border px-2 py-px text-[11px] text-muted-foreground">{e.type}</span> : i === current ? <ArrowRightIcon className="size-3.5 text-muted-foreground" /> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
