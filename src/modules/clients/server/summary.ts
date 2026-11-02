import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";
import { runMemoryTask } from "@/modules/memory/server/ai-tasks";
import { autoSpans, neutralizePlaceholders } from "@/modules/hide/mask";
import { createEphemeralMasker, getHideSettings, loadDetectionLists } from "@/modules/hide/server/masker";

/**
 * The short brief at the top of a client's page (CLAUDE.md §11). Made only from what this person
 * may open (their session, so RLS decides), masked by Hide like any AI task, kept per person and
 * made again when the client's memory, documents or this person's conversations change.
 */
const SUMMARY_SYSTEM = [
  "Task: brief a colleague who opens a client's page.",
  "From the material only, write a calm, elegant brief: one paragraph of 2 or 3 short sentences (60 words at most) saying who the client is and where things stand, then at most 3 bullet points with the most useful facts to keep in mind (one line each).",
  "Never invent anything. Say less rather than more: no figures, names or confidential details unless they are essential. If little is known, say so in one sentence.",
  "Write in {LANG}. Plain Markdown, no title.",
].join("\n");

export type ClientSummary = { text: string; createdAt: string; fresh: boolean } | { error: "empty" | "quota_exceeded" | "unavailable" };

export async function clientSummary(supabase: UserClient, ctx: MemberContext, clientId: string, locale: "fr" | "en", refresh: boolean): Promise<ClientSummary> {
  const { data: client } = await supabase.from("clients").select("name, sector, description").eq("id", clientId).maybeSingle();
  if (!client) return { error: "unavailable" };
  const { data: space } = await supabase.from("memory_spaces").select("id").eq("client_id", clientId).maybeSingle();
  const [{ data: entries }, { data: documents }, { data: conversations }] = await Promise.all([
    space ? supabase.from("memory_entries").select("title, content, updated_at").eq("space_id", space.id).order("updated_at", { ascending: false }).limit(25) : Promise.resolve({ data: [] }),
    space ? supabase.from("documents").select("filename, created_at").eq("space_id", space.id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    supabase.from("conversations").select("title, last_message_at").eq("client_id", clientId).eq("owner_id", ctx.user.id).order("last_message_at", { ascending: false }).limit(10),
  ]);
  const fingerprint = [
    locale,
    entries?.length ?? 0,
    entries?.[0]?.updated_at ?? "",
    documents?.length ?? 0,
    documents?.[0]?.created_at ?? "",
    conversations?.length ?? 0,
    conversations?.[0]?.last_message_at ?? "",
    (client.description ?? "").length,
  ].join("|");

  const { data: cached } = await supabase.from("client_summaries").select("content, fingerprint, created_at").eq("client_id", clientId).eq("user_id", ctx.user.id).maybeSingle();
  if (cached && !refresh && cached.fingerprint === fingerprint) return { text: cached.content, createdAt: cached.created_at, fresh: false };
  if (!client.description && !entries?.length && !documents?.length && !conversations?.length) return { error: "empty" };

  const material = neutralizePlaceholders(
    [
      `Client: ${client.name}${client.sector ? ` (${client.sector})` : ""}`,
      client.description ? `About the client: ${client.description}` : "",
      "",
      "## Client memory",
      ...(entries ?? []).map((e) => `- ${e.title}: ${e.content.slice(0, 400)}`),
      "",
      "## Documents",
      ...(documents ?? []).map((d) => `- ${d.filename}`),
      "",
      "## The reader's conversations about this client (titles)",
      ...(conversations ?? []).map((c) => `- ${c.title ?? "(untitled)"}`),
    ]
      .join("\n")
      .slice(0, 12_000),
  );

  // Hide, as for every AI task: masked when the company protects automatically by default.
  const settings = await getHideSettings(supabase, ctx.active.companyId);
  let user = material;
  let restore = (v: string) => v;
  if (settings.defaultModes.includes("automatic")) {
    const masker = createEphemeralMasker(await loadDetectionLists(supabase, ctx));
    const spans = autoSpans(masker.detect(material), new Set(settings.autoCategories));
    [{ masked: user }] = await masker.mask([{ text: material, spans }]);
    restore = masker.restore;
  }
  const result = await runMemoryTask(supabase, ctx, {
    system: SUMMARY_SYSTEM.replace("{LANG}", locale === "fr" ? "French" : "English"),
    user,
    feature: "client_summary",
  });
  if (!result.ok) return { error: result.error === "quota_exceeded" ? "quota_exceeded" : "unavailable" };
  const text = restore(result.text.trim()).slice(0, 3000);
  const createdAt = new Date().toISOString();
  await supabase
    .from("client_summaries")
    .upsert({ client_id: clientId, user_id: ctx.user.id, company_id: ctx.active.companyId, fingerprint, content: text, created_at: createdAt });
  return { text, createdAt, fresh: true };
}
