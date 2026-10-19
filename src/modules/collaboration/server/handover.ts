import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";
import { parseModelJson } from "@/modules/memory/json";
import { runMemoryTask } from "@/modules/memory/server/ai-tasks";
import { autoSpans, restorePlaceholders } from "@/modules/hide/mask";
import { hideConfigured } from "@/modules/hide/server/crypto";
import { conversationValues, createEphemeralMasker, getHideSettings, loadDetectionLists } from "@/modules/hide/server/masker";
import { HANDOVER_SECTIONS, type HandoverSections } from "../handover-sections";

/**
 * Smart Handover (CLAUDE.md §4.4): when a conversation or a restricted client is transferred, the
 * AI drafts a handover file from what the sender can see. It goes through Hide like any AI request;
 * the real values are put back for the recipient, who will have access to the same material.
 */

export { HANDOVER_SECTIONS, type HandoverSections };

export const HANDOVER_SYSTEM = [
  "Task: write a handover file.",
  "A colleague takes over this work. From the material below, write a JSON object, in the material's language, with exactly these keys:",
  '{"summary": "...", "decisions": "...", "documents": "...", "tasks": "...", "next_actions": "..."}',
  "- summary: 2 to 5 sentences on the work done so far.",
  '- decisions, documents, tasks, next_actions: short Markdown bullet lists ("- ..."); an empty string when there is nothing.',
  "- Use only what is in the material; never invent. Keep placeholders such as [CLIENT_1] exactly as written.",
  "Answer with the JSON object only.",
].join("\n");

const MAX_MATERIAL = 24_000;

function toSections(text: string, restore: (value: string) => string): HandoverSections | null {
  const json = parseModelJson(text) as Record<string, unknown> | null;
  if (!json || typeof json !== "object") return null;
  const sections = Object.fromEntries(HANDOVER_SECTIONS.map((key) => [key, restore(String(json[key] ?? "")).slice(0, 8000).trim()])) as HandoverSections;
  return Object.values(sections).some((v) => v) ? sections : null;
}

/** Draft for a conversation, from the messages the sender can see (as the models received them). */
export async function draftConversationHandover(supabase: UserClient, ctx: MemberContext, conversationId: string): Promise<HandoverSections | null> {
  const [{ data: conversation }, { data: messages }, { data: files }] = await Promise.all([
    supabase.from("conversations").select("title, model_choice").eq("id", conversationId).maybeSingle(),
    supabase.from("messages").select("author_type, author_id, content, masked_content, status").eq("conversation_id", conversationId).is("superseded_at", null).order("seq"),
    supabase.from("conversation_attachments").select("filename").eq("conversation_id", conversationId).not("message_id", "is", null),
  ]);
  if (!conversation || !messages?.length) return null;
  // People are numbered rather than named; Hide placeholders stay as the models already saw them.
  const people = new Map<string, number>();
  const label = (authorId: string | null) => {
    if (!authorId) return "Participant";
    if (!people.has(authorId)) people.set(authorId, people.size + 1);
    return `Participant ${people.get(authorId)}`;
  };
  const transcript = messages
    .filter((m) => m.content && m.status !== "error")
    .map((m) => `${m.author_type === "assistant" ? "Assistant" : label(m.author_id)}: ${m.masked_content ?? m.content}`)
    .join("\n\n")
    .slice(-MAX_MATERIAL);
  const material = [`Conversation: ${conversation.title ?? "(untitled)"}`, files?.length ? `Attached files: ${files.length}` : "", "", transcript].join("\n");

  const result = await runMemoryTask(supabase, ctx, { system: HANDOVER_SYSTEM, user: material, modelChoice: conversation.model_choice, feature: "handover" });
  if (!result.ok) return null;
  const masked = messages.some((m) => m.masked_content !== null);
  const values = masked && hideConfigured() ? await conversationValues(conversationId) : new Map<string, string>();
  return toSections(result.text, (v) => restorePlaceholders(v, values));
}

/** Draft for a restricted client: its memory, its documents and the sender's conversations about it. */
export async function draftClientHandover(supabase: UserClient, ctx: MemberContext, clientId: string): Promise<HandoverSections | null> {
  const companyId = ctx.active.companyId;
  const [{ data: client }, { data: space }] = await Promise.all([
    supabase.from("clients").select("name, sector, description").eq("id", clientId).maybeSingle(),
    supabase.from("memory_spaces").select("id").eq("client_id", clientId).maybeSingle(),
  ]);
  if (!client) return null;
  const [{ data: entries }, { data: documents }, { data: conversations }] = await Promise.all([
    space ? supabase.from("memory_entries").select("title, content").eq("space_id", space.id).order("updated_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    space ? supabase.from("documents").select("filename").eq("space_id", space.id).limit(50) : Promise.resolve({ data: [] }),
    supabase.from("conversations").select("id, title").eq("client_id", clientId).eq("owner_id", ctx.user.id).order("last_message_at", { ascending: false }).limit(10),
  ]);
  const excerpts: string[] = [];
  for (const c of conversations ?? []) {
    const { data: messages } = await supabase
      .from("messages")
      .select("author_type, content, status")
      .eq("conversation_id", c.id)
      .is("superseded_at", null)
      .order("seq", { ascending: false })
      .limit(12);
    const lines = (messages ?? []).reverse().filter((m) => m.content && m.status !== "error").map((m) => `${m.author_type === "assistant" ? "Assistant" : "Participant"}: ${m.content}`);
    if (lines.length) excerpts.push(`### Conversation: ${c.title ?? "(untitled)"}\n${lines.join("\n")}`);
  }
  const material = [
    `Client: ${client.name}${client.sector ? ` (${client.sector})` : ""}`,
    client.description ? `About the client: ${client.description}` : "",
    "",
    "## Client memory",
    ...(entries ?? []).map((e) => `- ${e.title}: ${e.content}`),
    "",
    "## Documents",
    ...(documents ?? []).map((d) => `- ${d.filename}`),
    "",
    "## Recent conversations",
    ...excerpts,
  ]
    .join("\n")
    .slice(0, MAX_MATERIAL);

  // Hide: with auto-protect on by default, the material is masked before it goes to the AI.
  const settings = await getHideSettings(supabase, companyId);
  let user = material;
  let restore = (v: string) => v;
  if (settings.defaultModes.includes("automatic")) {
    const masker = createEphemeralMasker(await loadDetectionLists(supabase, ctx));
    const spans = autoSpans(masker.detect(material), new Set(settings.autoCategories));
    const nameSpans = [...material.matchAll(new RegExp(client.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].map((m) => ({ start: m.index, end: m.index + client.name.length, category: "client" as const }));
    const all = [...nameSpans, ...spans.filter((s) => !nameSpans.some((n) => s.start < n.end && n.start < s.end))];
    [{ masked: user }] = await masker.mask([{ text: material, spans: all }]);
    restore = masker.restore;
  }
  const result = await runMemoryTask(supabase, ctx, { system: HANDOVER_SYSTEM, user, feature: "handover" });
  if (!result.ok) return null;
  return toSections(result.text, restore);
}
