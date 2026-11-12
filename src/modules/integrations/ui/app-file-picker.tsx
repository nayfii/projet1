"use client";

import * as React from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileTextIcon, PlugIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { readFromAppAction } from "../server/actions";

export type PickerConnection = { id: string; provider: string; accountLabel: string | null; apps: string[] };
type Hit = { id: string; name: string; modifiedAt: string | null; link: string | null };

/** The read capabilities of the apps that hold documents. */
const SOURCES = [
  { app: "drive", search: "drive.search", read: "drive.read" },
  { app: "onedrive", search: "onedrive.search", read: "onedrive.read" },
  { app: "notion", search: "notion.search", read: "notion.read" },
] as const;

/**
 * "Depuis une application": find a document in Google Drive, OneDrive / SharePoint or Notion through
 * a connection the person may use, read its text on our server, and hand it over (to a memory here).
 */
export function AppFilePicker({ connections, onPicked }: { connections: PickerConnection[]; onPicked: (file: { name: string; text: string }) => Promise<boolean> }) {
  const t = useTranslations("integrations.picker");
  const tApp = useTranslations("integrations.app");
  const tRun = useTranslations("integrations.runError");
  const format = useFormatter();
  const [open, setOpen] = React.useState(false);
  const options = connections.flatMap((c) => SOURCES.filter((s) => c.apps.includes(s.app)).map((s) => ({ key: `${c.id}:${s.app}`, connection: c, source: s })));
  const [selected, setSelected] = React.useState(options[0]?.key ?? "");
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<Hit[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const option = options.find((o) => o.key === selected) ?? options[0];

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!option) return;
    setBusy("search");
    const result = await readFromAppAction({ connectionId: option.connection.id, capability: option.source.search, input: { query, limit: 15 } });
    setBusy(null);
    if (!result.ok) {
      toast.error(tRun(result.error));
      return;
    }
    setHits(result.data as Hit[]);
  };

  const pick = async (hit: Hit) => {
    if (!option) return;
    setBusy(hit.id);
    const result = await readFromAppAction({ connectionId: option.connection.id, capability: option.source.read, input: { id: hit.id } });
    if (!result.ok) {
      setBusy(null);
      toast.error(tRun(result.error));
      return;
    }
    const file = result.data as { name: string; text: string };
    const ok = await onPicked({ name: file.name || hit.name, text: file.text });
    setBusy(null);
    if (ok) setOpen(false);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PlugIcon />
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          {options.length === 0 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>{t("none")}</p>
              <Button asChild variant="outline" size="sm">
                <Link href="/integrations">{t("connect")}</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {options.length > 1 ? (
                <select value={option?.key} onChange={(e) => { setSelected(e.target.value); setHits(null); }} aria-label={t("source")} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {tApp(o.source.app)} · {o.connection.accountLabel ?? ""}
                    </option>
                  ))}
                </select>
              ) : null}
              <form onSubmit={search} className="flex gap-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
                <Button type="submit" variant="outline" disabled={busy !== null}>
                  <SearchIcon />
                  {t("search")}
                </Button>
              </form>
              {hits ? (
                hits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noResult")}</p>
                ) : (
                  <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                    {hits.map((h) => (
                      <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{h.name}</span>
                          {h.modifiedAt ? <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(h.modifiedAt), { dateStyle: "medium" })}</span> : null}
                        </span>
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void pick(h)}>
                          {busy === h.id ? t("adding") : t("add")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
