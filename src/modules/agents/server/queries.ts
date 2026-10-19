import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { createClient, type UserClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  DEPARTMENTS,
  MEMORY_SCOPES,
  OUTPUT_FORMATS,
  fieldSchema,
  type AgentField,
  type Department,
  type MemoryScope,
  type OutputFormat,
  type ToolCapability,
  type Visibility,
} from "../definitions";

type AgentRow = Omit<Database["public"]["Tables"]["agents"]["Row"], "decided_at" | "decided_by" | "updated_at" | "source_conversation_id">;
type SettingsRow = Database["public"]["Tables"]["company_agent_settings"]["Row"];
type Role = Database["public"]["Enums"]["company_role"];

export type AgentSummary = {
  id: string;
  kind: "agent" | "tool";
  builtin: boolean;
  department: Department;
  name: string;
  description: string;
  visibility: Visibility;
  publication: "none" | "pending" | "approved" | "rejected";
  mine: boolean;
  /** The viewer may run it (enabled for their role, approved if shared company-wide). */
  usable: boolean;
  creatorName: string | null;
};

export type AgentDetail = AgentSummary & {
  instructions: string;
  inputFields: AgentField[];
  allowedModels: string[];
  defaultModel: string | null;
  tools: ToolCapability[];
  memoryScope: MemoryScope;
  outputFormat: OutputFormat;
  enabledRoles: Role[];
  createdAt: string;
};

const SELECT =
  "id, company_id, builtin_key, kind, department, name, description, instructions, input_fields, allowed_models, default_model, tools, memory_scope, output_format, visibility, team_id, publication, enabled_roles, created_by, created_at, creator:profiles!agents_created_by_fkey(full_name, email)";

function fields(value: unknown): AgentField[] {
  return Array.isArray(value) ? value.flatMap((f) => (fieldSchema.safeParse(f).success ? [f as AgentField] : [])) : [];
}

/** Whether the viewer may run it: the same rule as `private.can_use_agent` (the database re-checks). */
function usable(a: AgentRow, settings: SettingsRow | undefined, ctx: MemberContext): boolean {
  if (a.company_id === null) return (settings?.enabled ?? true) && (settings?.enabled_roles ?? a.enabled_roles).includes(ctx.active.role);
  if (a.visibility === "company" && a.publication !== "approved" && a.created_by !== ctx.user.id) return false;
  return a.enabled_roles.includes(ctx.active.role);
}

function toDetail(a: AgentRow & { creator: { full_name: string | null; email: string } | null }, settings: SettingsRow | undefined, ctx: MemberContext): AgentDetail {
  return {
    id: a.id,
    kind: a.kind as AgentDetail["kind"],
    builtin: a.company_id === null,
    department: (DEPARTMENTS as readonly string[]).includes(a.department) ? (a.department as Department) : "general",
    name: a.name,
    description: a.description,
    visibility: a.visibility as Visibility,
    publication: a.publication as AgentSummary["publication"],
    mine: a.created_by === ctx.user.id,
    usable: usable(a, settings, ctx),
    creatorName: a.creator?.full_name ?? a.creator?.email ?? null,
    instructions: a.instructions,
    inputFields: fields(a.input_fields),
    allowedModels: a.allowed_models,
    defaultModel: a.default_model,
    tools: a.tools as ToolCapability[],
    memoryScope: (MEMORY_SCOPES as readonly string[]).includes(a.memory_scope) ? (a.memory_scope as MemoryScope) : "company_and_client",
    outputFormat: (OUTPUT_FORMATS as readonly string[]).includes(a.output_format) ? (a.output_format as OutputFormat) : "text",
    enabledRoles: a.enabled_roles,
    createdAt: a.created_at,
  };
}

async function settingsFor(supabase: UserClient, companyId: string) {
  const { data } = await supabase.from("company_agent_settings").select("*").eq("company_id", companyId);
  return new Map((data ?? []).map((s) => [s.agent_id, s]));
}

/** Tools and agents the viewer can see (RLS), with whether they may run each. */
export async function listLibrary(ctx: MemberContext): Promise<AgentDetail[]> {
  const supabase = await createClient();
  const companyId = ctx.active.companyId;
  const [{ data }, settings] = await Promise.all([
    supabase.from("agents").select(SELECT).or(`company_id.eq.${companyId},company_id.is.null`).order("name"),
    settingsFor(supabase, companyId),
  ]);
  return (data ?? []).map((a) => toDetail(a, settings.get(a.id), ctx));
}

export async function getAgent(ctx: MemberContext, id: string): Promise<AgentDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("agents").select(SELECT).eq("id", id).maybeSingle();
  if (!data || (data.company_id !== null && data.company_id !== ctx.active.companyId)) return null;
  const settings = data.company_id === null ? (await settingsFor(supabase, ctx.active.companyId)).get(data.id) : undefined;
  return toDetail(data, settings, ctx);
}

/** What the AI gets when a conversation runs a tool or agent; null when the viewer may not run it. */
export type RunAgent = {
  id: string;
  name: string;
  instructions: string;
  outputFormat: OutputFormat;
  memoryScope: MemoryScope;
  allowedModels: string[];
  defaultModel: string | null;
  tools: ToolCapability[];
};

export async function resolveRunAgent(supabase: UserClient, ctx: MemberContext, agentId: string): Promise<RunAgent | null> {
  const { data } = await supabase.from("agents").select(SELECT).eq("id", agentId).maybeSingle();
  if (!data || (data.company_id !== null && data.company_id !== ctx.active.companyId)) return null;
  const settings = data.company_id === null ? (await settingsFor(supabase, ctx.active.companyId)).get(data.id) : undefined;
  const agent = toDetail(data, settings, ctx);
  if (!agent.usable) return null;
  // A company's adaptations of a built-in agent come after its own instructions.
  const addition = [settings?.instructions_addition?.trim(), settings?.tone?.trim() ? `Tone: ${settings.tone.trim()}` : ""].filter(Boolean).join("\n");
  return {
    id: agent.id,
    name: agent.name,
    instructions: addition ? `${agent.instructions}\n\nCompany adaptations:\n${addition}` : agent.instructions,
    outputFormat: agent.outputFormat,
    memoryScope: (settings?.memory_scope as MemoryScope | null) ?? agent.memoryScope,
    allowedModels: agent.allowedModels,
    defaultModel: settings?.default_model ?? agent.defaultModel,
    tools: agent.tools,
  };
}

/** Administration → Agents and tools: tools waiting for approval, shared tools, built-in agents. */
export async function listAdminAgents(ctx: MemberContext) {
  const all = await listLibrary(ctx);
  const companyTools = all.filter((a) => !a.builtin);
  return {
    pending: companyTools.filter((a) => a.visibility === "company" && a.publication === "pending"),
    shared: companyTools.filter((a) => a.visibility !== "private" && a.publication !== "pending" && a.publication !== "rejected"),
    builtins: all.filter((a) => a.builtin),
  };
}
