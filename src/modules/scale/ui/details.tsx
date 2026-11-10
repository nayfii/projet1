"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BuildingIcon, ExternalLinkIcon, FileTextIcon, HistoryIcon, LinkIcon, LoaderCircleIcon, MessageSquareIcon, PaperclipIcon, PlusIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import * as server from "../server/actions";
import { LINK_ROLES, type Activity, type Attachment, type Comment } from "../types";
import { Segmented, useDates } from "./primitives";
import { useIndex } from "./selectors";
import { usePanel, useScale, useScaleActions } from "./store";

type DetailType = "objective" | "project" | "milestone" | "task" | "test" | "decision" | "document";

/** Comments, links and files, and the history of an item, loaded when its panel or page opens. */
export function EntityExtras({ type, id }: { type: DetailType; id: string }) {
  const t = useTranslations("scale.extras");
  const { run } = useScaleActions();
  const [tab, setTab] = React.useState<"comments" | "files" | "history">("comments");
  const [state, setState] = React.useState<{ comments: Comment[]; attachments: Attachment[]; activity: Activity[] } | null>(null);
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    setFailed(false);
    const res = await server.getDetails(type, id).catch(() => null);
    if (res?.ok) setState(res.data);
    else setFailed(true);
  }, [type, id]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- details are loaded when the item opens
    setState(null);
    void load();
  }, [load]);

  return (
    <section className="space-y-3" aria-label={t("label")}>
      <Segmented
        value={tab}
        onChange={setTab}
        label={t("label")}
        options={[
          { value: "comments", label: t("comments", { count: state?.comments.length ?? 0 }), icon: <MessageSquareIcon /> },
          { value: "files", label: t("files", { count: state?.attachments.length ?? 0 }), icon: <PaperclipIcon /> },
          { value: "history", label: t("history"), icon: <HistoryIcon /> },
        ]}
      />
      {failed ? (
        <p className="text-sm text-destructive">
          {t("loadFailed")}{" "}
          <button type="button" className="font-medium underline" onClick={() => void load()}>
            {t("retry")}
          </button>
        </p>
      ) : !state ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          {t("loading")}
        </div>
      ) : tab === "comments" ? (
        <Comments type={type} id={id} items={state.comments} onChange={(comments) => setState({ ...state, comments })} run={run} />
      ) : tab === "files" ? (
        <Files type={type} id={id} items={state.attachments} onChange={(attachments) => setState({ ...state, attachments })} run={run} />
      ) : (
        <History items={state.activity} />
      )}
    </section>
  );
}

type Run = ReturnType<typeof useScaleActions>["run"];

function Comments({ type, id, items, onChange, run }: { type: DetailType; id: string; items: Comment[]; onChange: (c: Comment[]) => void; run: Run }) {
  const t = useTranslations("scale.extras");
  const index = useIndex();
  const data = useScale();
  const dates = useDates();
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function send() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const row = await run(() => server.addComment(type, id, body), { retry: () => void send() });
    setBusy(false);
    if (row) {
      onChange([...items, row]);
      setDraft("");
    }
  }
  return (
    <div className="space-y-3">
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("noComments")}</p> : null}
      <ul className="space-y-3">
        {items.map((c) => {
          const author = c.author_id ? index.personById.get(c.author_id) : null;
          return (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar name={author?.name ?? "?"} className="mt-0.5 size-6 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{author?.name ?? t("someone")}</span> · {dates.relative(c.created_at)}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
              {c.author_id === data.meId ? (
                <button
                  type="button"
                  aria-label={t("deleteComment")}
                  onClick={async () => {
                    const ok = await run(() => server.deleteComment(c.id));
                    if (ok) onChange(items.filter((x) => x.id !== c.id));
                  }}
                  className="self-start rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("commentPlaceholder")}
          aria-label={t("commentPlaceholder")}
          maxLength={5000}
          className="min-h-16"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex justify-end">
          <Button size="sm" disabled={!draft.trim() || busy} onClick={() => void send()}>
            {t("send")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Files({ type, id, items, onChange, run }: { type: DetailType; id: string; items: Attachment[]; onChange: (a: Attachment[]) => void; run: Run }) {
  const t = useTranslations("scale.extras");
  const [url, setUrl] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const file = React.useRef<HTMLInputElement>(null);
  const urlOk = /^https?:\/\/\S+\.\S+/.test(url.trim());

  async function addLink() {
    if (!urlOk) return;
    const row = await run(() => server.addLink(type, id, label, url));
    if (row) {
      onChange([...items, row]);
      setUrl("");
      setLabel("");
    }
  }

  async function upload(f: File) {
    if (f.size > 10 * 1024 * 1024) {
      await run(async () => ({ ok: false as const, error: "validation" as const }));
      return;
    }
    const form = new FormData();
    form.set("entityType", type);
    form.set("entityId", id);
    form.set("file", f);
    setUploading(true);
    const row = await run(() => server.uploadFile(form), { retry: () => void upload(f) });
    setUploading(false);
    if (row) onChange([...items, row]);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("noFiles")}</p> : null}
      <ul className="space-y-1">
        {items.map((a) => (
          <li key={a.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
            {a.kind === "link" ? <LinkIcon className="size-4 shrink-0 text-muted-foreground" /> : <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />}
            <a
              href={a.kind === "link" ? (a.url ?? "#") : `/api/scale/files/${a.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
            >
              {a.label}
            </a>
            <button
              type="button"
              aria-label={t("removeFile", { name: a.label })}
              onClick={async () => {
                const ok = await run(() => server.deleteAttachment(a.id));
                if (ok) onChange(items.filter((x) => x.id !== a.id));
              }}
              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label={t("linkUrl")} className="h-8 text-[13px]" />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("linkLabel")} aria-label={t("linkLabel")} maxLength={200} className="h-8 text-[13px]" />
        <Button size="sm" variant="outline" disabled={!urlOk} onClick={() => void addLink()}>
          <PlusIcon />
          {t("addLink")}
        </Button>
      </div>
      <div>
        <input
          ref={file}
          type="file"
          className="sr-only"
          aria-label={t("upload")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <Button size="sm" variant="ghost" disabled={uploading} onClick={() => file.current?.click()}>
          {uploading ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />}
          {t("upload")}
        </Button>
        <span className="ml-2 text-xs text-muted-foreground">{t("uploadHint")}</span>
      </div>
    </div>
  );
}

function History({ items }: { items: Activity[] }) {
  const t = useTranslations("scale.activity");
  const index = useIndex();
  const dates = useDates();
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("none")}</p>;
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {items.map((a) => {
        const who = a.actor_id ? (index.personById.get(a.actor_id)?.name ?? t("someone")) : t("someone");
        return (
          <li key={a.id} className="text-sm">
            <span aria-hidden className="absolute -left-[3.5px] mt-1.5 size-1.5 rounded-full bg-muted-foreground/60" />
            <ActivityLine activity={a} who={who} />
            <span className="block text-xs text-muted-foreground">{dates.relative(a.created_at)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** One line of history: who did what, with the old and new value for the tracked fields. */
export function ActivityLine({ activity, who }: { activity: Activity; who: string }) {
  const t = useTranslations("scale.activity");
  const tf = useTranslations("scale.fields");
  const value = useValueLabel();
  const d = (activity.details ?? {}) as { field?: string; from?: unknown; to?: unknown; title?: string };
  if (activity.action === "changed" && d.field) {
    return <span>{t("changed", { who, field: tf.has(d.field as Parameters<typeof tf>[0]) ? tf(d.field as Parameters<typeof tf>[0]) : d.field, from: value(d.field, d.from), to: value(d.field, d.to) })}</span>;
  }
  if (activity.action === "criterion_changed") return <span className="text-warning">{t("criterionChanged", { who, from: value("text", d.from), to: value("text", d.to) })}</span>;
  const action = `actions.${activity.action}` as Parameters<typeof t>[0];
  return <span>{t.has(action) ? t(action, { who, title: d.title ?? "" }) : t("actions.other", { who })}</span>;
}

/** Readable value of a tracked field (status names, people, dates…). */
export function useValueLabel() {
  const t = useTranslations("scale");
  const index = useIndex();
  const dates = useDates();
  return React.useCallback(
    (field: string, v: unknown): string => {
      if (v === null || v === undefined || v === "") return t("common.empty");
      if (typeof v === "boolean") return v ? t("common.yes") : t("common.no");
      const s = String(v);
      const map: Record<string, string> = { status: "anyStatus", priority: "priority", health: "health", horizon: "horizon", conclusion: "conclusion", validation_state: "validation", continuation: "continuation" };
      const key = `${map[field]}.${s}` as Parameters<typeof t>[0];
      if (map[field] && t.has(key)) return t(key);
      if (field.endsWith("_id")) {
        return index.personById.get(s)?.name ?? index.projectById.get(s)?.title ?? index.milestoneById.get(s)?.title ?? index.objectiveById.get(s)?.title ?? "—";
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dates.short(s);
      return s.length > 80 ? `${s.slice(0, 80)}…` : s;
    },
    [t, index, dates],
  );
}

// ─── Customer companies linked to an item (ids only) ────────────────────────

export function CompanyLinks({ entityType, entityId, roles = LINK_ROLES }: { entityType: "project" | "task" | "test" | "decision"; entityId: string; roles?: readonly (typeof LINK_ROLES)[number][] }) {
  const t = useTranslations("scale.companies");
  const data = useScale();
  const index = useIndex();
  const actions = useScaleActions();
  const panel = usePanel();
  const links = index.linksByEntity.get(`${entityType}:${entityId}`) ?? [];
  const linked = new Set(links.map((l) => l.company_id));
  const [query, setQuery] = React.useState("");
  const candidates = data.companies.filter((c) => !linked.has(c.id) && c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 30);
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");

  return (
    <div className="space-y-2">
      {links.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="space-y-1.5">
        {links.map((l) => {
          const c = index.companyById.get(l.company_id);
          return (
            <li key={l.id} className="rounded-lg border bg-card/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <BuildingIcon className="size-4 shrink-0 text-muted-foreground" />
                <button type="button" onClick={() => panel.open("company", l.company_id)} className="min-w-0 flex-1 truncate text-left text-sm font-medium underline-offset-2 hover:underline">
                  {c?.name ?? t("unknown")}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("roleOf", { name: c?.name ?? "" })}>
                    {t(`roles.${l.role}`)}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {roles.map((r) => (
                      <DropdownMenuItem key={r} onSelect={() => void actions.linkCompany(entityType, entityId, l.company_id, r, l.note)}>
                        {t(`roles.${r}`)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button type="button" aria-label={t("unlink", { name: c?.name ?? "" })} onClick={() => void actions.unlinkCompany(l.id)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                  <XIcon className="size-3.5" />
                </button>
              </div>
              {noteFor === l.id ? (
                <form
                  className="mt-2 space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await actions.linkCompany(entityType, entityId, l.company_id, l.role, note)) setNoteFor(null);
                  }}
                >
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} aria-label={t("note")} placeholder={t("notePlaceholder")} className="min-h-14 text-[13px]" autoFocus />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setNoteFor(null)}>
                      {t("cancel")}
                    </Button>
                    <Button type="submit" size="sm">
                      {t("save")}
                    </Button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNote(l.note ?? "");
                    setNoteFor(l.id);
                  }}
                  className={cn("mt-1 block w-full whitespace-pre-wrap text-left text-[13px]", l.note ? "text-foreground/90" : "text-muted-foreground hover:text-foreground")}
                >
                  {l.note || t("addNote")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <DropdownMenu onOpenChange={(o) => !o && setQuery("")}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="-ml-2">
            <PlusIcon />
            {t("link")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <div className="p-1">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={t("search")} aria-label={t("search")} className="h-8 text-[13px]" autoFocus />
          </div>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("companies")}</DropdownMenuLabel>
          <div className="max-h-64 overflow-y-auto">
            {candidates.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => void actions.linkCompany(entityType, entityId, c.id, roles[0] ?? "other", null)}>
                <BuildingIcon />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.status !== "active" ? <span className="text-xs text-muted-foreground">{t(`status.${c.status === "suspended" ? "suspended" : "other"}`)}</span> : null}
              </DropdownMenuItem>
            ))}
            {candidates.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{data.companies.length ? t("noMatch") : t("noCompanies")}</p> : null}
          </div>
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">{t("privacy")}</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Link to a customer's page in our console (metadata only, as everywhere in the console). */
export function CompanyConsoleLink({ id }: { id: string }) {
  const t = useTranslations("scale.companies");
  return (
    <Link href={`/platform/companies/${id}`} className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline">
      <ExternalLinkIcon className="size-3.5" />
      {t("openInPlatform")}
    </Link>
  );
}
