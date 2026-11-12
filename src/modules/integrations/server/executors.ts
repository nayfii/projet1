import "server-only";
import { z } from "zod";
import { extractDocument } from "@/modules/documents/server/extract";

/**
 * The capabilities of each connected app, against the providers' official APIs. Inputs are validated
 * here; outputs are short, normalised records. A provider error comes back as a code, never as the
 * provider's raw message (which may quote content).
 */

export class ProviderCallError extends Error {
  constructor(readonly code: "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "provider_error" | "unsupported_file" | "validation") {
    super(code);
  }
}

type Call = (path: string, init?: RequestInit & { raw?: boolean }) => Promise<Response>;

/** A fetch with the connection's token; HTTP errors become codes. */
export function caller(base: string, accessToken: string, extraHeaders: Record<string, string> = {}): Call {
  return async (path, init = {}) => {
    const res = await fetch(path.startsWith("http") ? path : `${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...extraHeaders, ...(init.headers as Record<string, string> | undefined) },
      cache: "no-store",
    });
    if (res.status === 401) throw new ProviderCallError("unauthorized");
    if (res.status === 403) throw new ProviderCallError("forbidden");
    if (res.status === 404) throw new ProviderCallError("not_found");
    if (res.status === 429) throw new ProviderCallError("rate_limited");
    if (!res.ok) throw new ProviderCallError("provider_error");
    return res;
  };
}

const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const MAX_TEXT = 40_000;
const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

/** A plain-text e-mail, encoded the way Gmail's API expects (RFC 2822, base64url). */
export function rawEmail(input: { to: string[]; subject: string; body: string }): string {
  const subject = /^[\x20-\x7e]*$/.test(input.subject) ? input.subject : `=?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`;
  const message = [`To: ${input.to.join(", ")}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", input.body].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

const email = z.object({ to: z.array(z.email()).min(1).max(20), subject: z.string().trim().min(1).max(250), body: z.string().min(1).max(20_000) });
const search = z.object({ query: z.string().trim().max(200).default(""), limit: z.number().int().min(1).max(25).default(10) });
const range = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), limit: z.number().int().min(1).max(50).default(20) });
const event = z.object({ title: z.string().trim().min(1).max(250), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }), description: z.string().max(5000).optional(), attendees: z.array(z.email()).max(50).default([]) });
const fileRef = z.object({ id: z.string().min(1).max(300) });

export type FileHit = { id: string; name: string; kind: string; modifiedAt: string | null; link: string | null };

type Executor = (call: Call, input: unknown) => Promise<unknown>;

// ─── Google ───────────────────────────────────────────────────────────────────

const GOOGLE_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const google: Record<string, Executor> = {
  "gmail.search": async (call, input) => {
    const { query, limit } = search.parse(input);
    const list = await json<{ messages?: { id: string }[] }>(await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=${encodeURIComponent(query)}`));
    return Promise.all(
      (list.messages ?? []).map(async (m) => {
        const msg = await json<{ id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } }>(
          await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`),
        );
        const h = (name: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? null;
        return { id: msg.id, subject: h("Subject"), from: h("From"), date: h("Date"), snippet: msg.snippet ?? "" };
      }),
    );
  },
  "gmail.draft": async (call, input) => {
    const raw = rawEmail(email.parse(input));
    const draft = await json<{ id: string }>(await call("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: { raw } }) }));
    return { id: draft.id };
  },
  "gmail.send": async (call, input) => {
    const raw = rawEmail(email.parse(input));
    const sent = await json<{ id: string }>(await call("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw }) }));
    return { id: sent.id };
  },
  "calendar.events": async (call, input) => {
    const { from, to, limit } = range.parse(input);
    const params = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(limit), timeMin: from ?? new Date().toISOString() });
    if (to) params.set("timeMax", to);
    const data = await json<{ items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; htmlLink?: string }[] }>(
      await call(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`),
    );
    return (data.items ?? []).map((e) => ({ id: e.id, title: e.summary ?? "", start: e.start?.dateTime ?? e.start?.date ?? null, end: e.end?.dateTime ?? e.end?.date ?? null, link: e.htmlLink ?? null }));
  },
  "calendar.create_event": async (call, input) => {
    const e = event.parse(input);
    const created = await json<{ id: string; htmlLink?: string }>(
      await call("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: e.title, description: e.description, start: { dateTime: e.start }, end: { dateTime: e.end }, attendees: e.attendees.map((a) => ({ email: a })) }),
      }),
    );
    return { id: created.id, link: created.htmlLink ?? null };
  },
  "drive.search": async (call, input) => {
    const { query, limit } = search.parse(input);
    const q = [`trashed = false`, query ? `fullText contains '${query.replace(/['\\]/g, "\\$&")}'` : null].filter(Boolean).join(" and ");
    const data = await json<{ files?: { id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string }[] }>(
      await call(`https://www.googleapis.com/drive/v3/files?pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&q=${encodeURIComponent(q)}`),
    );
    return (data.files ?? []).map((f): FileHit => ({ id: f.id, name: f.name, kind: f.mimeType, modifiedAt: f.modifiedTime ?? null, link: f.webViewLink ?? null }));
  },
  "drive.read": async (call, input) => {
    const { id } = fileRef.parse(input);
    const meta = await json<{ name: string; mimeType: string }>(await call(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name,mimeType`));
    const exportAs = GOOGLE_EXPORTS[meta.mimeType];
    const res = exportAs
      ? await call(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exportAs)}`)
      : await call(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
    return { name: meta.name, text: await fileText(meta.name, meta.mimeType, res, Boolean(exportAs)) };
  },
};

/** The text of a downloaded file: text formats as they are; PDF and Office files read on our server. */
async function fileText(name: string, mime: string, res: Response, exported: boolean): Promise<string> {
  if (exported || mime.startsWith("text/") || /\.(md|txt|csv)$/i.test(name)) return cut(await res.text());
  const ext = /\.(pdf|docx|xlsx)$/i.exec(name)?.[1]?.toLowerCase() as "pdf" | "docx" | "xlsx" | undefined;
  if (!ext) throw new ProviderCallError("unsupported_file");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new ProviderCallError("unsupported_file");
  return cut((await extractDocument(bytes, ext, MAX_TEXT)).text);
}

// ─── Microsoft Graph ──────────────────────────────────────────────────────────

const GRAPH = "https://graph.microsoft.com/v1.0";
const graphMail = (e: z.infer<typeof email>) => ({ subject: e.subject, body: { contentType: "Text", content: e.body }, toRecipients: e.to.map((address) => ({ emailAddress: { address } })) });

const microsoft: Record<string, Executor> = {
  "outlook.search": async (call, input) => {
    const { query, limit } = search.parse(input);
    const params = new URLSearchParams({ $top: String(limit), $select: "id,subject,from,receivedDateTime,bodyPreview,webLink" });
    if (query) params.set("$search", `"${query.replace(/"/g, "")}"`);
    const data = await json<{ value?: { id: string; subject?: string; from?: { emailAddress?: { name?: string; address?: string } }; receivedDateTime?: string; bodyPreview?: string; webLink?: string }[] }>(
      await call(`${GRAPH}/me/messages?${params}`),
    );
    return (data.value ?? []).map((m) => ({ id: m.id, subject: m.subject ?? null, from: m.from?.emailAddress?.address ?? null, date: m.receivedDateTime ?? null, snippet: m.bodyPreview ?? "", link: m.webLink ?? null }));
  },
  "outlook.draft": async (call, input) => {
    const created = await json<{ id: string; webLink?: string }>(await call(`${GRAPH}/me/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(graphMail(email.parse(input))) }));
    return { id: created.id, link: created.webLink ?? null };
  },
  "outlook.send": async (call, input) => {
    await call(`${GRAPH}/me/sendMail`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: graphMail(email.parse(input)), saveToSentItems: true }) });
    return { sent: true };
  },
  "outlook_calendar.events": async (call, input) => {
    const { from, to, limit } = range.parse(input);
    const start = from ?? new Date().toISOString();
    const end = to ?? new Date(Date.parse(start) + 14 * 86_400_000).toISOString();
    const data = await json<{ value?: { id: string; subject?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; webLink?: string }[] }>(
      await call(`${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=${limit}&$orderby=start/dateTime`, { headers: { Prefer: 'outlook.timezone="UTC"' } }),
    );
    return (data.value ?? []).map((e) => ({ id: e.id, title: e.subject ?? "", start: e.start?.dateTime ?? null, end: e.end?.dateTime ?? null, link: e.webLink ?? null }));
  },
  "outlook_calendar.create_event": async (call, input) => {
    const e = event.parse(input);
    const created = await json<{ id: string; webLink?: string }>(
      await call(`${GRAPH}/me/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: e.title,
          body: { contentType: "Text", content: e.description ?? "" },
          start: { dateTime: e.start, timeZone: "UTC" },
          end: { dateTime: e.end, timeZone: "UTC" },
          attendees: e.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
        }),
      }),
    );
    return { id: created.id, link: created.webLink ?? null };
  },
  "onedrive.search": async (call, input) => {
    const { query, limit } = search.parse(input);
    const path = query ? `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(query.replace(/'/g, "''"))}')?$top=${limit}` : `${GRAPH}/me/drive/recent?$top=${limit}`;
    const data = await json<{ value?: { id: string; name: string; file?: { mimeType?: string }; folder?: unknown; lastModifiedDateTime?: string; webUrl?: string }[] }>(await call(path));
    return (data.value ?? []).filter((f) => !f.folder).map((f): FileHit => ({ id: f.id, name: f.name, kind: f.file?.mimeType ?? "", modifiedAt: f.lastModifiedDateTime ?? null, link: f.webUrl ?? null }));
  },
  "onedrive.read": async (call, input) => {
    const { id } = fileRef.parse(input);
    const meta = await json<{ name: string; file?: { mimeType?: string } }>(await call(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}?$select=name,file`));
    return { name: meta.name, text: await fileText(meta.name, meta.file?.mimeType ?? "", await call(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`), false) };
  },
  "teams.channels": async (call) => {
    const teams = await json<{ value?: { id: string; displayName: string }[] }>(await call(`${GRAPH}/me/joinedTeams`));
    const out: { teamId: string; team: string; channelId: string; channel: string }[] = [];
    for (const t of (teams.value ?? []).slice(0, 20)) {
      const channels = await json<{ value?: { id: string; displayName: string }[] }>(await call(`${GRAPH}/teams/${t.id}/channels`));
      for (const c of channels.value ?? []) out.push({ teamId: t.id, team: t.displayName, channelId: c.id, channel: c.displayName });
    }
    return out;
  },
  "teams.post": async (call, input) => {
    const p = z.object({ teamId: z.string().min(1).max(200), channelId: z.string().min(1).max(200), text: z.string().min(1).max(20_000) }).parse(input);
    const created = await json<{ id: string; webUrl?: string }>(
      await call(`${GRAPH}/teams/${encodeURIComponent(p.teamId)}/channels/${encodeURIComponent(p.channelId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: { contentType: "text", content: p.text } }) }),
    );
    return { id: created.id, link: created.webUrl ?? null };
  },
};

// ─── Slack ────────────────────────────────────────────────────────────────────

/** Slack answers 200 with ok:false on errors. */
async function slackJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!body.ok) {
    if (body.error === "invalid_auth" || body.error === "token_revoked" || body.error === "not_authed") throw new ProviderCallError("unauthorized");
    if (body.error === "not_in_channel" || body.error === "missing_scope") throw new ProviderCallError("forbidden");
    if (body.error === "channel_not_found") throw new ProviderCallError("not_found");
    throw new ProviderCallError("provider_error");
  }
  return body;
}

const slack: Record<string, Executor> = {
  "slack.channels": async (call) => {
    const data = await slackJson<{ channels: { id: string; name: string; is_member: boolean }[] }>(await call("https://slack.com/api/conversations.list?exclude_archived=true&limit=200&types=public_channel"));
    return data.channels.map((c) => ({ id: c.id, name: c.name, member: c.is_member }));
  },
  "slack.read": async (call, input) => {
    const p = z.object({ channel: z.string().min(1).max(50), limit: z.number().int().min(1).max(100).default(30) }).parse(input);
    const data = await slackJson<{ messages: { ts: string; text?: string; user?: string }[] }>(await call(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(p.channel)}&limit=${p.limit}`));
    return data.messages.map((m) => ({ ts: m.ts, user: m.user ?? null, text: m.text ?? "" }));
  },
  "slack.post": async (call, input) => {
    const p = z.object({ channel: z.string().min(1).max(50), text: z.string().min(1).max(30_000) }).parse(input);
    const data = await slackJson<{ ts: string; channel: string }>(
      await call("https://slack.com/api/chat.postMessage", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: p.channel, text: p.text }) }),
    );
    return { ts: data.ts, channel: data.channel };
  },
};

// ─── Notion ───────────────────────────────────────────────────────────────────

type NotionRichText = { plain_text?: string }[];
const plain = (rt: NotionRichText | undefined) => (rt ?? []).map((t) => t.plain_text ?? "").join("");

function notionTitle(page: { properties?: Record<string, { type?: string; title?: NotionRichText }> }): string {
  const prop = Object.values(page.properties ?? {}).find((p) => p.type === "title");
  return plain(prop?.title) || "—";
}

const notion: Record<string, Executor> = {
  "notion.search": async (call, input) => {
    const { query, limit } = search.parse(input);
    const data = await json<{ results: { id: string; object: string; url?: string; last_edited_time?: string; properties?: Record<string, { type?: string; title?: NotionRichText }> }[] }>(
      await call("https://api.notion.com/v1/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, page_size: limit, filter: { property: "object", value: "page" } }) }),
    );
    return data.results.map((p): FileHit => ({ id: p.id, name: notionTitle(p), kind: "notion/page", modifiedAt: p.last_edited_time ?? null, link: p.url ?? null }));
  },
  "notion.read": async (call, input) => {
    const { id } = fileRef.parse(input);
    const page = await json<{ properties?: Record<string, { type?: string; title?: NotionRichText }> }>(await call(`https://api.notion.com/v1/pages/${encodeURIComponent(id)}`));
    const lines: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const data = await json<{ results: Record<string, unknown>[]; has_more: boolean; next_cursor: string | null }>(
        await call(`https://api.notion.com/v1/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`),
      );
      for (const block of data.results) {
        const type = block.type as string;
        const value = block[type] as { rich_text?: NotionRichText } | undefined;
        const text = plain(value?.rich_text);
        if (text) lines.push(type.startsWith("heading") ? `## ${text}` : type.includes("list_item") ? `- ${text}` : text);
      }
      if (!data.has_more || !data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return { name: notionTitle(page), text: cut(lines.join("\n")) };
  },
  "notion.create_page": async (call, input) => {
    const p = z.object({ parentPageId: z.string().min(1).max(100), title: z.string().trim().min(1).max(200), text: z.string().max(20_000).default("") }).parse(input);
    const paragraphs = p.text
      .split(/\n{2,}/)
      .filter(Boolean)
      .slice(0, 90)
      .map((t) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: t.slice(0, 2000) } }] } }));
    const page = await json<{ id: string; url?: string }>(
      await call("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: { page_id: p.parentPageId }, properties: { title: { title: [{ text: { content: p.title } }] } }, children: paragraphs }),
      }),
    );
    return { id: page.id, link: page.url ?? null };
  },
};

// ─── Canva ────────────────────────────────────────────────────────────────────

const CANVA = "https://api.canva.com/rest/v1";
const canva: Record<string, Executor> = {
  "canva.designs": async (call, input) => {
    const { query, limit } = search.parse(input);
    const data = await json<{ items?: { id: string; title?: string; updated_at?: number; urls?: { edit_url?: string } }[] }>(await call(`${CANVA}/designs?limit=${limit}${query ? `&query=${encodeURIComponent(query)}` : ""}`));
    return (data.items ?? []).map((d) => ({ id: d.id, title: d.title ?? "", updatedAt: d.updated_at ? new Date(d.updated_at * 1000).toISOString() : null, link: d.urls?.edit_url ?? null }));
  },
  // A blank design of a standard type: the API cannot write content into a design (only brand
  // templates' autofill, reserved to Canva Enterprise). Shown as a limitation.
  "canva.create": async (call, input) => {
    const p = z.object({ title: z.string().trim().min(1).max(255), type: z.enum(["doc", "presentation", "whiteboard"]).default("presentation") }).parse(input);
    const data = await json<{ design: { id: string; urls?: { edit_url?: string } } }>(
      await call(`${CANVA}/designs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design_type: { type: "preset", name: p.type }, title: p.title }) }),
    );
    return { id: data.design.id, link: data.design.urls?.edit_url ?? null };
  },
  // Exports are asynchronous: the job is started, then read until it is done (about 20 s at most here).
  "canva.export": async (call, input) => {
    const p = z.object({ designId: z.string().min(1).max(100), format: z.enum(["pdf", "png"]).default("pdf") }).parse(input);
    const started = await json<{ job: { id: string; status: string; urls?: string[] } }>(
      await call(`${CANVA}/exports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design_id: p.designId, format: { type: p.format } }) }),
    );
    let job = started.job;
    for (let i = 0; i < 20 && job.status === "in_progress"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      job = (await json<{ job: typeof job }>(await call(`${CANVA}/exports/${job.id}`))).job;
    }
    if (job.status !== "success") throw new ProviderCallError("provider_error");
    return { urls: job.urls ?? [] };
  },
};

export const EXECUTORS: Record<string, { base: string; headers?: Record<string, string>; run: Record<string, Executor> }> = {
  google: { base: "https://www.googleapis.com", run: google },
  microsoft: { base: GRAPH, run: microsoft },
  slack: { base: "https://slack.com/api", run: slack },
  notion: { base: "https://api.notion.com/v1", headers: { "Notion-Version": "2022-06-28" }, run: notion },
  canva: { base: CANVA, run: canva },
};
