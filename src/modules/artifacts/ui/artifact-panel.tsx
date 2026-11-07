"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, PencilIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Markdown } from "@/modules/conversations/ui/markdown";
import { parseTables, slidesOf, tablesToMarkdown, type ArtifactVersion, type SheetTable } from "../parse";
import { ARTIFACT_ICONS } from "./artifact-card";

const DOWNLOADS: Record<ArtifactVersion["kind"], ("pdf" | "docx" | "md" | "xlsx" | "csv" | "code")[]> = {
  document: ["pdf", "docx", "md"],
  slides: ["pdf", "md"],
  sheet: ["xlsx", "csv"],
  code: ["code"],
};

/**
 * The workspace on the right: the artifact open in the conversation, with its versions, a view made
 * for its kind (a page, slides, a table, code), editing (saved as a new version, posted to the
 * conversation so the AI works on it next) and downloads. The conversation stays the place to ask
 * for changes.
 */
export function ArtifactPanel({
  versions,
  version,
  onVersion,
  onClose,
  onSave,
  canEdit,
  updating,
}: {
  versions: ArtifactVersion[];
  version: number | null;
  onVersion: (version: number) => void;
  onClose: () => void;
  /** Posts the edited content as a new version; false when it could not be saved. */
  onSave: (artifact: ArtifactVersion, body: string) => Promise<boolean>;
  canEdit: boolean;
  /** The AI is writing a new version right now. */
  updating: boolean;
}) {
  const t = useTranslations("artifacts");
  const format = useFormatter();
  const current = versions.find((v) => v.version === version) ?? versions.at(-1)!;
  const Icon = ARTIFACT_ICONS[current.kind];
  const title = current.title || t(`kind.${current.kind}`);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const latest = current.version === versions.length;

  // Another artifact or version: leave the editor.
  const shown = `${current.key}:${current.version}`;
  const [shownBefore, setShownBefore] = React.useState(shown);
  if (shown !== shownBefore) {
    setShownBefore(shown);
    setEditing(false);
  }

  const save = async (body: string) => {
    if (body.trim() === current.body.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(current, body);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <section aria-label={t("panel", { title })} data-testid="artifact-panel" className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        {versions.length > 1 ? (
          <select
            aria-label={t("versions")}
            value={current.version}
            onChange={(e) => onVersion(Number(e.target.value))}
            className="h-8 max-w-40 rounded-md border bg-background px-2 text-xs text-muted-foreground"
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                {t("versionOption", { version: v.version, by: v.role === "user" ? "user" : "ai", date: format.dateTime(new Date(v.createdAt), { hour: "2-digit", minute: "2-digit" }) })}
              </option>
            ))}
          </select>
        ) : null}
        {canEdit && !editing ? (
          <Tooltip content={latest ? t("edit") : t("editOld")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("edit")}
              onClick={() => {
                setDraft(current.body);
                setEditing(true);
              }}
            >
              <PencilIcon />
            </Button>
          </Tooltip>
        ) : null}
        <DropdownMenu>
          <Tooltip content={t("download")}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("download")}>
                <DownloadIcon />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{t("download")}</DropdownMenuLabel>
            {DOWNLOADS[current.kind].map((f) => (
              <DropdownMenuItem key={f} asChild>
                <a href={`/api/messages/${current.messageId}/artifacts/${current.index}?format=${f}`} download>
                  {t(`format.${f}`)}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      {updating ? (
        <p role="status" className="flex shrink-0 items-center gap-2 border-b bg-accent/40 px-4 py-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          {t("updating")}
        </p>
      ) : !latest ? (
        <p className="flex shrink-0 items-center justify-between gap-2 border-b bg-accent/40 px-4 py-2 text-xs text-muted-foreground">
          {t("oldVersion", { version: current.version, total: versions.length })}
          <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => onVersion(versions.length)}>
            {t("showLatest")}
          </button>
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {editing ? (
          current.kind === "sheet" ? (
            <SheetEditor body={current.body} saving={saving} onCancel={() => setEditing(false)} onSave={(body) => void save(body)} />
          ) : (
            <TextEditor value={draft} onChange={setDraft} saving={saving} code={current.kind === "code"} onCancel={() => setEditing(false)} onSave={() => void save(draft)} />
          )
        ) : !current.body.trim() ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : current.kind === "document" ? (
          <div className="px-4 py-6 sm:px-8">
            <div data-testid="artifact-page" className="mx-auto max-w-[760px] rounded-xl border bg-card px-6 py-8 sm:px-10 sm:py-10">
              <Markdown>{current.body}</Markdown>
            </div>
          </div>
        ) : current.kind === "slides" ? (
          <SlidesView body={current.body} />
        ) : current.kind === "sheet" ? (
          <SheetView body={current.body} />
        ) : (
          <CodeView body={current.body} lang={current.lang} />
        )}
      </div>
    </section>
  );
}

function TextEditor({ value, onChange, onSave, onCancel, saving, code }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; saving: boolean; code: boolean }) {
  const t = useTranslations("artifacts");
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">{code ? t("editCodeHint") : t("editHint")}</p>
      <textarea
        autoFocus
        aria-label={t("edit")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave();
          }
        }}
        spellCheck={!code}
        className="min-h-0 flex-1 resize-none rounded-lg border bg-card p-4 font-mono text-[13px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <EditActions saving={saving} onCancel={onCancel} onSave={onSave} />
    </div>
  );
}

function EditActions({ saving, onCancel, onSave }: { saving: boolean; onCancel: () => void; onSave: () => void }) {
  const t = useTranslations("artifacts");
  return (
    <div className="flex shrink-0 justify-end gap-2">
      <Button variant="ghost" onClick={onCancel} disabled={saving}>
        {t("cancel")}
      </Button>
      <Button onClick={onSave} disabled={saving}>
        {saving ? <Spinner /> : null}
        {t("save")}
      </Button>
    </div>
  );
}

/** One slide at a time in 16:9, with the list of slides to jump to; ← → move between them. */
function SlidesView({ body }: { body: string }) {
  const t = useTranslations("artifacts");
  const slides = React.useMemo(() => slidesOf(body), [body]);
  const [index, setIndex] = React.useState(0);
  const at = Math.min(index, Math.max(0, slides.length - 1));
  const go = (n: number) => setIndex(Math.max(0, Math.min(slides.length - 1, n)));
  return (
    <div
      className="flex h-full flex-col gap-4 p-4 outline-none sm:p-6"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(at + 1);
        if (e.key === "ArrowLeft") go(at - 1);
      }}
    >
      <div data-testid="artifact-slide" className="aspect-video w-full overflow-hidden rounded-xl border bg-card px-8 py-7 text-[15px] sm:px-12 sm:py-10 [&_h1]:text-2xl sm:[&_h1]:text-3xl">
        <Markdown>{slides[at] ?? ""}</Markdown>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("previousSlide")} disabled={at === 0} onClick={() => go(at - 1)}>
          <ChevronLeftIcon />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">{t("slideOf", { index: at + 1, total: slides.length })}</span>
        <Button variant="ghost" size="icon-sm" aria-label={t("nextSlide")} disabled={at >= slides.length - 1} onClick={() => go(at + 1)}>
          <ChevronRightIcon />
        </Button>
      </div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {slides.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={i === at}
              className={cn("w-full truncate rounded-lg border px-2.5 py-2 text-left text-xs", i === at ? "border-foreground/30 bg-accent" : "text-muted-foreground hover:bg-accent/60")}
            >
              {`${i + 1}. ${/^#{1,3}\s+(.+)$/m.exec(s)?.[1] ?? t("slide")}`}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const isNumber = (v: string) => /^-?[\d\s.,]+%?$/.test(v.trim()) && /\d/.test(v);

function SheetView({ body }: { body: string }) {
  const tables = React.useMemo(() => parseTables(body), [body]);
  return (
    <div className="space-y-6 p-4 sm:p-6">
      {tables.map((table, ti) => (
        <div key={ti} className="overflow-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {table.header.map((h, i) => (
                  <th key={i} className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri} className="even:bg-muted/30">
                  {row.map((cell, ci) => (
                    <td key={ci} className={cn("border-b px-3 py-1.5", isNumber(cell) && "text-right tabular-nums")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** Cells to edit in place; rows can be added or removed. */
function SheetEditor({ body, saving, onCancel, onSave }: { body: string; saving: boolean; onCancel: () => void; onSave: (body: string) => void }) {
  const t = useTranslations("artifacts");
  const [tables, setTables] = React.useState<SheetTable[]>(() => parseTables(body));
  const set = (ti: number, ri: number, ci: number, value: string) =>
    setTables((all) => all.map((tb, i) => (i !== ti ? tb : { ...tb, rows: tb.rows.map((r, j) => (j !== ri ? r : r.map((c, k) => (k === ci ? value : c)))) })));
  const setHeader = (ti: number, ci: number, value: string) => setTables((all) => all.map((tb, i) => (i !== ti ? tb : { ...tb, header: tb.header.map((h, k) => (k === ci ? value : h)) })));
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="min-h-0 flex-1 space-y-6 overflow-auto">
        {tables.map((table, ti) => (
          <div key={ti} className="space-y-2">
            <div className="overflow-auto rounded-lg border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted">
                  <tr>
                    {table.header.map((h, ci) => (
                      <th key={ci} className="border-b p-0">
                        <input aria-label={t("cell", { row: 0, column: ci + 1 })} value={h} onChange={(e) => setHeader(ti, ci, e.target.value)} className="w-full min-w-24 bg-transparent px-3 py-2 font-medium outline-none focus:bg-background" />
                      </th>
                    ))}
                    <th className="w-8 border-b" />
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-b p-0">
                          <input
                            aria-label={t("cell", { row: ri + 1, column: ci + 1 })}
                            value={cell}
                            onChange={(e) => set(ti, ri, ci, e.target.value)}
                            className={cn("w-full min-w-24 bg-transparent px-3 py-1.5 outline-none focus:bg-accent/50", isNumber(cell) && "text-right tabular-nums")}
                          />
                        </td>
                      ))}
                      <td className="border-b text-center">
                        <button
                          type="button"
                          aria-label={t("removeRow", { row: ri + 1 })}
                          onClick={() => setTables((all) => all.map((tb, i) => (i !== ti ? tb : { ...tb, rows: tb.rows.filter((_, j) => j !== ri) })))}
                          className="rounded p-1 text-muted-foreground hover:text-foreground"
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTables((all) => all.map((tb, i) => (i !== ti ? tb : { ...tb, rows: [...tb.rows, tb.header.map(() => "")] })))}
            >
              {t("addRow")}
            </Button>
          </div>
        ))}
      </div>
      <EditActions saving={saving} onCancel={onCancel} onSave={() => onSave(tablesToMarkdown(tables))} />
    </div>
  );
}

function CodeView({ body, lang }: { body: string; lang: string | null }) {
  const t = useTranslations("artifacts");
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="relative p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{lang ?? t("kind.code")}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(body);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <pre className="overflow-auto rounded-lg border bg-muted/60 p-4 font-mono text-[13px] leading-6">{body}</pre>
    </div>
  );
}
