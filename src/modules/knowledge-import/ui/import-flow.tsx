"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckIcon, FileUpIcon, LoaderIcon, PauseIcon, PlayIcon, RotateCcwIcon, ShieldCheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clip, shortHash } from "../adapters";
import { exportFingerprint, readExport } from "../archive";
import { IMPORT_LIMITS, ImportReadError, type ImportedItem, type ImportSource, type ImportWarning, type ParsedExport } from "../types";
import { analyzeImportBatchAction, finishAnalysisAction, startImportAction } from "../server/actions";

const SOURCES: ImportSource[] = ["chatgpt", "claude", "gemini", "perplexity", "files"];
const ACCEPT = ".zip,.json,.md,.markdown,.txt,.html,.htm,.csv,.pdf,.docx";

type Ready = { parsed: ParsedExport; items: ImportedItem[]; fileNames: string[]; warnings: ImportWarning[] };
type Phase =
  | { kind: "idle" }
  | { kind: "reading"; read: number; total: number }
  | { kind: "ready"; ready: Ready }
  | { kind: "analyzing"; ready: Ready; importId: string; queue: ImportedItem[]; next: number; proposed: number; excluded: number; duplicates: number; paused: boolean; error: string | null; resumed: boolean }
  | { kind: "error"; code: string };

/**
 * "Enrichir mes connaissances": choose the former tool (or just drop the export), the archive is read
 * here in the browser, then analysed in small batches on our server with a real progress, pausable and
 * resumable. When the analysis ends, the proposals open for review.
 */
export function ImportFlow({ onboarding = false }: { onboarding?: boolean }) {
  const t = useTranslations("knowledgeImport");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [source, setSource] = React.useState<ImportSource | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const pause = React.useRef(false);

  const read = async (files: File[]) => {
    if (files.length === 0) return;
    setPhase({ kind: "reading", read: 0, total: files.reduce((n, f) => n + f.size, 0) });
    try {
      const parsed = await readExport(files, source, (done, total) => setPhase({ kind: "reading", read: done, total }));
      const warnings = [...parsed.warnings];
      const items = [...parsed.items];
      // PDF and Word: their text is read on our server (in memory, not stored).
      for (const binary of parsed.binaries) {
        const form = new FormData();
        form.set("file", new File([new Uint8Array(binary.data)], binary.name));
        const res = await fetch("/api/knowledge-import/extract", { method: "POST", body: form }).catch(() => null);
        const body = res?.ok ? ((await res.json()) as { text?: string }) : null;
        if (body?.text && body.text.length >= IMPORT_LIMITS.minChars) {
          items.push({ ref: shortHash(`${parsed.source}:document:${binary.name}:${binary.data.length}`), kind: "document", title: binary.name.replace(/\.[a-z]+$/i, ""), date: null, text: clip(body.text) });
        } else if (!warnings.includes("unsupported_file")) warnings.push("unsupported_file");
      }
      if (items.length === 0) throw new ImportReadError("nothing_found");
      setPhase({ kind: "ready", ready: { parsed, items, fileNames: files.map((f) => f.name), warnings } });
    } catch (error) {
      setPhase({ kind: "error", code: error instanceof ImportReadError ? error.code : "invalid_archive" });
    }
  };

  const start = async (ready: Ready) => {
    const selected = ready.items.slice(0, IMPORT_LIMITS.analysed);
    const result = await startImportAction({
      source: ready.parsed.source,
      fileName: ready.fileNames.join(", ").slice(0, 255),
      fingerprint: exportFingerprint(ready.parsed, ready.fileNames),
      found: ready.items.length + ready.parsed.skipped,
      selected: selected.length,
    });
    if (!result.ok) {
      setPhase({ kind: "error", code: result.error });
      return;
    }
    const done = new Set(result.data!.processed);
    const queue = selected.filter((i) => !done.has(i.ref));
    pause.current = false;
    void run({ kind: "analyzing", ready, importId: result.data!.importId, queue, next: 0, proposed: 0, excluded: 0, duplicates: 0, paused: false, error: null, resumed: result.data!.resumed });
  };

  const run = async (state: Extract<Phase, { kind: "analyzing" }>) => {
    let current = { ...state, paused: false, error: null };
    setPhase(current);
    while (current.next < current.queue.length) {
      if (pause.current) {
        setPhase({ ...current, paused: true });
        return;
      }
      const batch = current.queue.slice(current.next, current.next + IMPORT_LIMITS.batch);
      const result = await analyzeImportBatchAction({ importId: current.importId, items: batch });
      if (!result.ok) {
        setPhase({ ...current, paused: true, error: result.error });
        return;
      }
      current = {
        ...current,
        next: current.next + batch.length,
        proposed: current.proposed + result.data!.proposed,
        excluded: current.excluded + result.data!.excluded,
        duplicates: current.duplicates + result.data!.duplicates,
      };
      setPhase(current);
    }
    await finishAnalysisAction({ importId: current.importId });
    setPhase({ kind: "idle" });
    router.replace(`/memory/import?import=${current.importId}${onboarding ? "&from=onboarding" : ""}`);
    router.refresh();
  };

  const busy = phase.kind === "reading" || (phase.kind === "analyzing" && !phase.paused);

  return (
    <section className="space-y-5" aria-labelledby="import-step">
      <div className="space-y-2.5">
        <h2 id="import-step" className="text-sm font-medium">
          {t("chooseSource")}
        </h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("chooseSource")}>
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={source === s}
              disabled={busy}
              onClick={() => setSource(source === s ? null : s)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-50",
                source === s ? "border-foreground/40 bg-foreground/[0.06] font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t(`source.${s}`)}
            </button>
          ))}
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground" data-testid="export-guide">
          {source ? t(`guide.${source}`) : t("guide.auto")}
        </p>
      </div>

      {phase.kind === "idle" || phase.kind === "error" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void read([...e.dataTransfer.files]);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-foreground/40 bg-foreground/[0.04]" : "bg-card/40",
          )}
        >
          <FileUpIcon className="size-6 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("dropTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("dropBody")}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            {t("chooseFiles")}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label={t("chooseFiles")}
            data-testid="import-input"
            onChange={(e) => {
              void read([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          {phase.kind === "error" ? (
            <p role="alert" className="flex items-start gap-2 text-left text-[13px] text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {t.has(`readError.${phase.code}` as "readError.invalid_archive") ? t(`readError.${phase.code}` as "readError.invalid_archive") : tErrors(phase.code as "unknown")}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase.kind === "reading" ? (
        <Progress label={t("reading")} value={phase.total ? phase.read / phase.total : 0} detail={t("readingDetail")} />
      ) : null}

      {phase.kind === "ready" ? (
        <div className="space-y-4 rounded-2xl border bg-card p-5" data-testid="import-ready">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckIcon className="size-4 text-success" />
              {t("recognised", { source: t(`source.${phase.ready.parsed.source}`) })}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {t("foundCount", { count: phase.ready.items.length })}
              {phase.ready.items.length > IMPORT_LIMITS.analysed ? ` · ${t("analysedLimit", { count: IMPORT_LIMITS.analysed })}` : ""}
            </p>
          </div>
          {phase.ready.warnings.length > 0 ? (
            <ul className="space-y-1 text-[13px] text-muted-foreground">
              {phase.ready.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2">
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  {t(`warning.${w}`)}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
            {t("beforeAnalysis")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void start(phase.ready)}>{t("analyse")}</Button>
            <Button variant="ghost" onClick={() => setPhase({ kind: "idle" })}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {phase.kind === "analyzing" ? (
        <div className="space-y-4 rounded-2xl border bg-card p-5" data-testid="import-analyzing">
          <Progress
            label={phase.paused ? t("paused") : t("analysing")}
            value={phase.queue.length ? phase.next / phase.queue.length : 1}
            detail={t("analysingDetail", { done: phase.next, total: phase.queue.length })}
          />
          {phase.resumed ? <p className="text-[13px] text-muted-foreground">{t("resumed")}</p> : null}
          <p className="text-[13px] text-muted-foreground" data-testid="import-counters">
            {t("counters", { proposed: phase.proposed, excluded: phase.excluded, duplicates: phase.duplicates })}
          </p>
          {phase.error ? (
            <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {t.has(`batchError.${phase.error}` as "batchError.provider_error") ? t(`batchError.${phase.error}` as "batchError.provider_error") : tErrors(phase.error as "unknown")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {phase.paused ? (
              <Button
                onClick={() => {
                  pause.current = false;
                  void run(phase);
                }}
              >
                {phase.error ? <RotateCcwIcon /> : <PlayIcon />}
                {phase.error ? t("retry") : t("resume")}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => (pause.current = true)}>
                <PauseIcon />
                {t("pause")}
              </Button>
            )}
            {phase.paused ? (
              <Button variant="ghost" onClick={() => setPhase({ kind: "idle" })}>
                <XIcon />
                {t("stopHere")}
              </Button>
            ) : null}
          </div>
          {phase.paused ? <p className="text-xs text-muted-foreground">{t("resumeLater")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function Progress({ label, value, detail }: { label: string; value: number; detail: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium">
          {percent < 100 ? <LoaderIcon className="size-4 animate-spin text-muted-foreground" /> : <CheckIcon className="size-4 text-success" />}
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">{percent} %</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full origin-left rounded-full bg-foreground/70 transition-transform duration-300" style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
