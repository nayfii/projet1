"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { FileTextIcon, SearchIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { rank } from "../logic/search";
import { CategoryGlyph, StatusIcon } from "./primitives";
import { useCategoryLabel, useIndex } from "./selectors";
import { useStudio } from "./store";
import type { TaskStatus } from "../types";

type Item = { id: string; title: string; detail?: string | null; icon?: React.ReactNode };

/** A searchable list in a small window: pick one (Enter, arrows, or a click). */
function PickerDialog({ title, description, items, onPick, onClose, empty }: { title: string; description: string; items: Item[]; onPick: (id: string) => void; onClose: () => void; empty: string }) {
  const tc = useTranslations("studio.common");
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const shown = query.trim() ? rank(query, items, (i) => [i.title, i.detail]).map((r) => r.item) : items.slice(0, 50);
  const current = Math.min(active, Math.max(0, shown.length - 1));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} className="max-w-lg gap-3 p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="mx-5 flex items-center gap-2 rounded-lg border px-3">
          <SearchIcon className="size-4 text-muted-foreground" />
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
                setActive((current + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % Math.max(1, shown.length));
              }
              if (e.key === "Enter" && shown[current]) {
                e.preventDefault();
                onPick(shown[current].id);
              }
            }}
            placeholder={tc("searchPlaceholder")}
            aria-label={tc("searchPlaceholder")}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <ul role="listbox" aria-label={title} className="max-h-80 overflow-y-auto px-2 pb-3">
          {shown.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</li> : null}
          {shown.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === current}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(item.id)}
                className={cn("flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm", i === current ? "bg-accent" : "hover:bg-accent/60")}
              >
                {item.icon}
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {item.detail ? <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Pick a document of Knowledge (archived ones and those already linked are left out). */
export function DocumentPicker({ exclude, onPick, onClose }: { exclude: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const t = useTranslations("studio.pickers");
  const data = useStudio();
  const index = useIndex();
  const category = useCategoryLabel();
  const items = data.documents
    .filter((d) => !d.archived_at && !exclude.includes(d.id))
    .map((d) => {
      const c = d.category_id ? index.categories.get(d.category_id) : null;
      return { id: d.id, title: d.title, detail: category(d.category_id), icon: c ? <CategoryGlyph icon={c.icon} className="text-muted-foreground" /> : <FileTextIcon className="size-4 text-muted-foreground" /> };
    });
  return <PickerDialog title={t("documentTitle")} description={t("documentDescription")} items={items} onPick={onPick} onClose={onClose} empty={t("noDocument")} />;
}

/** Pick an open task (for a milestone: those not in it yet). */
export function TaskPicker({ exclude, onPick, onClose }: { exclude: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const t = useTranslations("studio.pickers");
  const data = useStudio();
  const index = useIndex();
  const items = data.tasks
    .filter((x) => !x.archived_at && x.status !== "done" && x.status !== "cancelled" && !exclude.includes(x.id))
    .map((x) => ({ id: x.id, title: x.title, detail: x.milestone_id ? (index.milestones.get(x.milestone_id)?.title ?? null) : null, icon: <StatusIcon status={x.status as TaskStatus} /> }));
  return <PickerDialog title={t("taskTitle")} description={t("taskDescription")} items={items} onPick={onPick} onClose={onClose} empty={t("noTask")} />;
}
