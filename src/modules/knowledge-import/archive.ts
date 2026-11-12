import { Unzip, UnzipInflate } from "fflate";
import {
  detectJson,
  looksLikePerplexity,
  readChatGpt,
  readClaude,
  readClaudeProjects,
  readGeminiActivity,
  readGeminiActivityHtml,
  readTextFile,
} from "./adapters";
import { IMPORT_LIMITS, ImportReadError, type ImportedItem, type ImportSource, type ImportWarning, type ParsedExport } from "./types";

/**
 * Reads what the person dropped (an export archive, or loose files) IN THEIR BROWSER: the archive is
 * never uploaded nor stored. A ZIP is streamed (constant memory): only the files the readers need are
 * decompressed, under size, count and ratio limits; dangerous paths and nested archives are skipped.
 */

type Kind = "json" | "claude-projects" | "gemini-json" | "gemini-html" | "md" | "txt" | "html" | "csv" | "pdf" | "docx";

const TEXT_KINDS: Record<string, Kind> = { md: "md", markdown: "md", txt: "txt", html: "html", htm: "html", csv: "csv", pdf: "pdf", docx: "docx", json: "json" };

const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";

/** Absolute paths, parent references, drive letters, control characters: never followed. */
export function isDangerousPath(name: string): boolean {
  return name.startsWith("/") || name.startsWith("\\") || /(^|[\\/])\.\.([\\/]|$)/.test(name) || /^[a-z]:/i.test(name) || /[\u0000-\u001f]/.test(name);
}

/** Which files of an archive are read, and how. */
function classify(name: string): Kind | null {
  const lower = name.toLowerCase();
  if (/(^|\/)conversations(-\d+)?\.json$/.test(lower)) return "json";
  if (/(^|\/)projects\.json$/.test(lower)) return "claude-projects";
  if (/(gemini|bard)/.test(lower) && /\.json$/.test(lower)) return "gemini-json";
  if (/(gemini|bard)/.test(lower) && /\.html?$/.test(lower)) return "gemini-html";
  // The rest of a Google Takeout is other products' data; ChatGPT's chat.html repeats conversations.json.
  if (lower.startsWith("takeout/") || /(^|\/)chat\.html$/.test(lower) || /(^|\/)__macosx\//.test(lower)) return null;
  const kind = TEXT_KINDS[extension(lower)];
  return kind && kind !== "json" ? kind : null;
}

type Collected = { name: string; kind: Kind; bytes: Uint8Array };

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function readZip(file: Blob, warnings: Set<ImportWarning>, onProgress?: (read: number) => void): Promise<Collected[]> {
  const collected: Collected[] = [];
  let failure: ImportReadError | null = null;
  let entries = 0;
  let total = 0;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (f) => {
    if (failure) return;
    if (++entries > IMPORT_LIMITS.entries) {
      failure = new ImportReadError("too_many_files");
      return;
    }
    if (f.name.endsWith("/")) return;
    if (isDangerousPath(f.name)) {
      warnings.add("dangerous_path");
      return;
    }
    if (/\.(zip|7z|rar|tar|gz|tgz)$/i.test(f.name)) {
      warnings.add("nested_archive");
      return;
    }
    const kind = classify(f.name);
    if (!kind) return;
    if ((kind === "pdf" || kind === "docx") && (f.originalSize ?? 0) > IMPORT_LIMITS.binaryBytes) {
      warnings.add("binary_too_large");
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let skippedBinary = false;
    f.ondata = (err, data, final) => {
      if (failure || skippedBinary) return;
      if (err) {
        failure = new ImportReadError("invalid_archive");
        return;
      }
      size += data.length;
      total += data.length;
      const cap = kind === "pdf" || kind === "docx" ? IMPORT_LIMITS.binaryBytes : IMPORT_LIMITS.entryBytes;
      const compressed = f.size ?? 0;
      if (size > 50 * 1024 ** 2 && compressed > 0 && size / compressed > IMPORT_LIMITS.ratio) {
        failure = new ImportReadError("suspicious_archive");
        f.terminate();
        return;
      }
      if ((kind === "pdf" || kind === "docx") && size > cap) {
        // A document too large to read here is left out, not the whole archive.
        warnings.add("binary_too_large");
        skippedBinary = true;
        f.terminate();
        return;
      }
      if (size > cap || total > IMPORT_LIMITS.totalBytes) {
        failure = new ImportReadError("archive_too_large");
        f.terminate();
        return;
      }
      chunks.push(data);
      if (final) collected.push({ name: f.name, kind, bytes: concat(chunks, size) });
    };
    f.start();
  };

  const reader = file.stream().getReader();
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        unzip.push(new Uint8Array(0), true);
        break;
      }
      read += value.length;
      unzip.push(value, false);
      onProgress?.(read);
      if (failure) break;
    }
  } catch {
    failure ??= new ImportReadError("invalid_archive");
  }
  if (failure) {
    await reader.cancel().catch(() => undefined);
    throw failure;
  }
  if (entries === 0) throw new ImportReadError("invalid_archive");
  return collected;
}

const decoder = () => new TextDecoder("utf-8", { fatal: false });

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder().decode(bytes).replace(/^﻿/, ""));
  } catch {
    throw new ImportReadError("invalid_archive");
  }
}

/** Turns the collected files into items, with the source they come from. */
function readCollected(collected: Collected[], hint: ImportSource | null, warnings: Set<ImportWarning>): ParsedExport {
  const items: ImportedItem[] = [];
  const sources = new Map<ImportSource, number>();
  const binaries: ParsedExport["binaries"] = [];
  let skipped = 0;
  let unrecognised = 0;
  const add = (source: ImportSource, result: { items: ImportedItem[]; skipped: number }) => {
    items.push(...result.items);
    skipped += result.skipped;
    sources.set(source, (sources.get(source) ?? 0) + result.items.length + result.skipped);
  };

  for (const file of collected) {
    switch (file.kind) {
      case "json":
      case "gemini-json": {
        const json = parseJson(file.bytes);
        const source = detectJson(json);
        if (source === "chatgpt") add(source, readChatGpt(json));
        else if (source === "claude") add(source, readClaude(json));
        else if (source === "gemini") add(source, readGeminiActivity(json));
        else unrecognised++;
        break;
      }
      case "claude-projects": {
        const projects = readClaudeProjects(parseJson(file.bytes));
        if (projects.documents > 0) warnings.add("documents_not_imported");
        add("claude", projects);
        break;
      }
      case "gemini-html":
        add("gemini", readGeminiActivityHtml(decoder().decode(file.bytes)));
        break;
      case "md":
      case "txt":
      case "html":
      case "csv": {
        const text = decoder().decode(file.bytes);
        const source: ImportSource = hint === "perplexity" || looksLikePerplexity(file.name, text) ? "perplexity" : (hint ?? "files");
        add(source === "chatgpt" || source === "claude" || source === "gemini" ? "files" : source, readTextFile(source, file.name, text, file.kind));
        break;
      }
      case "pdf":
      case "docx":
        if (binaries.length >= IMPORT_LIMITS.binaries) warnings.add("truncated");
        else binaries.push({ name: file.name.replace(/^.*\//, ""), kind: file.kind, data: file.bytes });
        break;
    }
  }

  // One export, one source: the one most items came from (loose files: the person's choice).
  const source = [...sources].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (hint && binaries.length ? hint : null);
  if (!source) throw new ImportReadError(unrecognised > 0 ? "unrecognised_format" : "nothing_found");
  const unique = new Map(items.map((i) => [i.ref, i]));
  const sorted = [...unique.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  if (sorted.length === 0 && binaries.length === 0) throw new ImportReadError("nothing_found");
  return { source, items: sorted, skipped, binaries, warnings: [...warnings] };
}

/**
 * Reads the dropped files. `hint`: the tool the person chose (decides for loose Markdown or text files).
 * `onProgress`: bytes read so far, of `total`.
 */
export async function readExport(files: { name: string; size: number; stream(): ReadableStream<Uint8Array>; arrayBuffer(): Promise<ArrayBuffer> }[], hint: ImportSource | null, onProgress?: (read: number, total: number) => void): Promise<ParsedExport> {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > IMPORT_LIMITS.archiveBytes) throw new ImportReadError("archive_too_large");
  const warnings = new Set<ImportWarning>();
  const collected: Collected[] = [];
  let done = 0;
  for (const file of files) {
    const ext = extension(file.name);
    if (ext === "zip") {
      collected.push(...(await readZip(file as unknown as Blob, warnings, (read) => onProgress?.(done + read, total))));
    } else if (TEXT_KINDS[ext]) {
      const kind = TEXT_KINDS[ext];
      if ((kind === "pdf" || kind === "docx") && file.size > IMPORT_LIMITS.binaryBytes) warnings.add("binary_too_large");
      else if (file.size > IMPORT_LIMITS.entryBytes) throw new ImportReadError("archive_too_large");
      else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const lower = file.name.toLowerCase();
        collected.push({ name: file.name, kind: kind === "json" && /(gemini|bard|activit)/.test(lower) ? "gemini-json" : kind === "json" && /projects\.json$/.test(lower) ? "claude-projects" : kind, bytes });
      }
    } else {
      warnings.add("unsupported_file");
    }
    done += file.size;
    onProgress?.(done, total);
  }
  return readCollected(collected, hint, warnings);
}

/** A fingerprint of an export: the same export dropped again resumes the same import. */
export function exportFingerprint(parsed: ParsedExport, fileNames: string[]): string {
  const refs = parsed.items.map((i) => i.ref).join(",");
  let a = 0x811c9dc5;
  const text = `${parsed.source}|${fileNames.join("|")}|${refs}`;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return `${parsed.source}-${parsed.items.length}-${(a >>> 0).toString(16)}`;
}
