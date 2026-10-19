"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberOrNull } from "@/lib/auth/guards";
import { toErrorCode, type ActionResult } from "@/lib/errors";
import { PLACEHOLDER_PATTERN } from "@/modules/hide/categories";
import { restorePlaceholders } from "@/modules/hide/mask";
import { hideConfigured } from "@/modules/hide/server/crypto";
import { conversationValues } from "@/modules/hide/server/masker";
import { parseModelJson } from "@/modules/memory/json";
import { runMemoryTask } from "@/modules/memory/server/ai-tasks";
import { defaultChoice, getCompanyModels } from "@/modules/providers/server/models";
import { MODEL_CHOICE_AUTO } from "@/modules/providers/catalog";
import { listClients } from "@/modules/clients/server/queries";
import {
  DEPARTMENTS,
  FIELD_TYPES,
  MEMORY_SCOPES,
  OUTPUT_FORMATS,
  VISIBILITIES,
  composeRunMessage,
  fieldKey,
  invalidRunFields,
  toolSchema,
  type ToolInput,
} from "../definitions";
import { getAgent } from "./queries";
import { TOOL_DRAFT_SYSTEM } from "../prompts";

export type ToolDraft = { tool: ToolInput; aiGenerated: boolean; specific: boolean };

/** "Turn into a tool": the AI drafts a tool from the conversation; the person reviews it before saving. */
export async function draftToolAction(input: { conversationId: string }): Promise<ActionResult<ToolDraft>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ conversationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const supabase = await createClient();
  const [{ data: conversation }, { data: messages }] = await Promise.all([
    supabase.from("conversations").select("id, title, model_choice").eq("id", parsed.data.conversationId).maybeSingle(),
    supabase
      .from("messages")
      .select("author_type, content, masked_content, status")
      .eq("conversation_id", parsed.data.conversationId)
      .is("superseded_at", null)
      .order("seq"),
  ]);
  if (!conversation) return { ok: false, error: "not_found" };
  const blank: ToolInput = {
    name: (conversation.title ?? "").slice(0, 80),
    description: "",
    department: "general",
    instructions: "",
    input_fields: [],
    allowed_models: [],
    default_model: null,
    tools: [],
    memory_scope: "company_and_client",
    output_format: "text",
  };
  // The conversation as the models received it (Hide placeholders kept).
  const transcript = (messages ?? [])
    .filter((m) => m.content && m.status !== "error")
    .map((m) => `${m.author_type === "assistant" ? "Assistant" : "Person"}: ${m.masked_content ?? m.content}`)
    .join("\n\n")
    .slice(-24_000);
  if (!transcript) return { ok: true, data: { tool: blank, aiGenerated: false, specific: false } };

  const result = await runMemoryTask(supabase, ctx, { system: TOOL_DRAFT_SYSTEM, user: transcript, modelChoice: conversation.model_choice, feature: "agent" });
  if (!result.ok) return { ok: true, data: { tool: blank, aiGenerated: false, specific: false } };
  const json = parseModelJson(result.text) as Record<string, unknown> | null;
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: true, data: { tool: blank, aiGenerated: false, specific: false } };

  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T => ((list as readonly string[]).includes(value as string) ? (value as T) : fallback);
  const taken = new Set<string>();
  const fields = (Array.isArray(json.input_fields) ? json.input_fields : []).slice(0, 6).flatMap((f) => {
    const label = text((f as Record<string, unknown>)?.label, 80);
    if (!label) return [];
    const type = oneOf((f as Record<string, unknown>).type, FIELD_TYPES, "text");
    const options = Array.isArray((f as Record<string, unknown>).options) ? ((f as Record<string, unknown>).options as unknown[]).map((o) => text(o, 80)).filter(Boolean).slice(0, 20) : [];
    const key = fieldKey(label, taken);
    taken.add(key);
    return [{ key, label, type: type === "select" && options.length === 0 ? ("text" as const) : type, required: Boolean((f as Record<string, unknown>).required), ...(type === "select" && options.length ? { options } : {}) }];
  });
  let tool: ToolInput = {
    ...blank,
    name: text(json.name, 80) || blank.name,
    description: text(json.description, 400),
    department: oneOf(json.department, DEPARTMENTS, "general"),
    instructions: text(json.instructions, 8000),
    input_fields: fields,
    output_format: oneOf(json.output_format, OUTPUT_FORMATS, "text"),
    memory_scope: oneOf(json.memory_scope, MEMORY_SCOPES, "company_and_client"),
  };
  // Placeholders left by the AI point at something specific to this conversation: shown with their
  // real value to the person (who saw them) and flagged so they generalise it before sharing.
  const draftText = JSON.stringify(tool);
  const specific = new RegExp(PLACEHOLDER_PATTERN.source).test(draftText);
  if (specific && hideConfigured()) {
    const values = await conversationValues(parsed.data.conversationId);
    tool = JSON.parse(restorePlaceholders(draftText, values)) as ToolInput;
  }
  return { ok: true, data: { tool, aiGenerated: true, specific } };
}

const saveSchema = z.object({
  id: z.uuid().nullable(),
  tool: toolSchema,
  visibility: z.enum(VISIBILITIES),
  sourceConversationId: z.uuid().nullable(),
});

/** Saves a tool. Shared with the whole company, it waits for an Admin's approval (checked in SQL). */
export async function saveToolAction(input: z.input<typeof saveSchema>): Promise<ActionResult<{ id: string; publication: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  // Models: only those the company allows (or Auto).
  const models = await getCompanyModels(ctx.active.companyId);
  const allowedIds = new Set(models.allowed.map((m) => m.id));
  const { tool } = parsed.data;
  if (tool.allowed_models.some((m) => !allowedIds.has(m))) return { ok: false, error: "invalid_models" };
  if (tool.default_model && tool.default_model !== MODEL_CHOICE_AUTO && !allowedIds.has(tool.default_model)) return { ok: false, error: "invalid_models" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_tool", {
    p_company: ctx.active.companyId,
    // null creates a new tool (the generated types do not mark this argument as nullable).
    p_id: parsed.data.id as string,
    p_tool: tool,
    p_visibility: parsed.data.visibility,
    p_source_conversation: parsed.data.sourceConversationId ?? undefined,
  });
  if (error || !data) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/library", "layout");
  revalidatePath("/admin/agents");
  const { data: saved } = await supabase.from("agents").select("publication").eq("id", data).maybeSingle();
  return { ok: true, data: { id: data, publication: saved?.publication ?? "none" } };
}

export async function deleteToolAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("delete_tool", { p_agent: parsed.data.id });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/library", "layout");
  revalidatePath("/admin/agents");
  return { ok: true };
}

export async function decideToolAction(input: { id: string; approve: boolean }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ id: z.uuid(), approve: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("decide_tool", { p_agent: parsed.data.id, p_approve: parsed.data.approve });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/agents");
  revalidatePath("/library", "layout");
  return { ok: true };
}

export async function setToolRolesAction(input: { id: string; roles: string[] }): Promise<ActionResult> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ id: z.uuid(), roles: z.array(z.enum(["owner", "admin", "member"])).max(3) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { error } = await (await createClient()).rpc("set_tool_roles", { p_agent: parsed.data.id, p_roles: parsed.data.roles });
  if (error) return { ok: false, error: toErrorCode(error) };
  revalidatePath("/admin/agents");
  revalidatePath("/library", "layout");
  return { ok: true };
}

/**
 * Runs a tool or agent: checks the form, starts a conversation linked to it (and to the client chosen
 * in the form) and returns the first message, which the conversation screen then sends.
 */
export async function startRunAction(input: { agentId: string; values: Record<string, string> }): Promise<ActionResult<{ conversationId: string; message: string }>> {
  const ctx = await memberOrNull();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = z.object({ agentId: z.uuid(), values: z.record(z.string().max(60), z.string().max(20_000)) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const agent = await getAgent(ctx, parsed.data.agentId);
  if (!agent || !agent.usable) return { ok: false, error: "not_found" };
  if (invalidRunFields(agent.inputFields, parsed.data.values).length > 0) return { ok: false, error: "validation" };

  // A "client" field takes only clients this person can work on; the conversation is linked to it.
  const clients = await listClients(ctx.active.companyId);
  const reachable = clients.filter((c) => c.visibility === "open" || ctx.active.role === "owner" || c.assignees.some((a) => a.userId === ctx.user.id));
  const clientField = agent.inputFields.find((f) => f.type === "client" && parsed.data.values[f.key]);
  const clientId = clientField ? parsed.data.values[clientField.key] : null;
  if (clientId && !reachable.some((c) => c.id === clientId)) return { ok: false, error: "validation" };

  const models = await getCompanyModels(ctx.active.companyId);
  const choice =
    agent.defaultModel && (agent.defaultModel === MODEL_CHOICE_AUTO ? models.autoEnabled : models.allowed.some((m) => m.id === agent.defaultModel))
      ? agent.defaultModel
      : (agent.allowedModels.find((id) => models.allowed.some((m) => m.id === id)) ?? defaultChoice(models));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ company_id: ctx.active.companyId, client_id: clientId, title: agent.name, model_choice: choice, agent_id: agent.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: toErrorCode(error) };
  const message = composeRunMessage(agent.inputFields, parsed.data.values, (id) => reachable.find((c) => c.id === id)?.name ?? null);
  revalidatePath("/chat", "layout");
  return { ok: true, data: { conversationId: data.id, message: message || agent.name } };
}
