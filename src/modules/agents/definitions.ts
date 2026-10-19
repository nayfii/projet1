import { z } from "zod";

/**
 * Tools and agents share one framework (CLAUDE.md §4.6, §4.7): instructions, an input form, allowed
 * models, capabilities, memory scope and an output format. Running one starts a conversation whose
 * first message is the filled form, so Hide, memory permissions, Source Proof and quotas apply as usual.
 */

export const DEPARTMENTS = ["marketing", "sales", "accounting", "finance", "hr", "legal", "customer_service", "management", "general"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const FIELD_TYPES = ["text", "textarea", "client", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const OUTPUT_FORMATS = ["text", "table", "email", "document"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const MEMORY_SCOPES = ["none", "company", "company_and_client"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const TOOL_CAPABILITIES = ["attachments"] as const;
export type ToolCapability = (typeof TOOL_CAPABILITIES)[number];

export const VISIBILITIES = ["private", "team", "company"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export type AgentField = { key: string; label: string; type: FieldType; required: boolean; options?: string[] };

export const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

/** What a person reviews and saves ("Turn into a tool", editing a tool). */
export const toolSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400),
  department: z.enum(DEPARTMENTS),
  instructions: z.string().trim().min(1).max(8000),
  input_fields: z
    .array(fieldSchema)
    .max(12)
    .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, "duplicate keys")
    .refine((fields) => fields.every((f) => f.type !== "select" || (f.options?.length ?? 0) > 0), "select needs options"),
  allowed_models: z.array(z.string().regex(/^[a-z0-9][a-z0-9._-]{1,62}$/)).max(20),
  default_model: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,62}$/).nullable(),
  tools: z.array(z.enum(TOOL_CAPABILITIES)).max(TOOL_CAPABILITIES.length),
  memory_scope: z.enum(MEMORY_SCOPES),
  output_format: z.enum(OUTPUT_FORMATS),
});
export type ToolInput = z.infer<typeof toolSchema>;

/** A key for a form field, from its label ("Notes de réunion" → "notes_de_reunion"). */
export function fieldKey(label: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 32) || "field";
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

/** Instruction appended for the chosen output format. */
export function outputFormatInstruction(format: OutputFormat): string | null {
  switch (format) {
    case "table":
      return "Present the result as a Markdown table, with a short sentence before it if useful.";
    case "email":
      return "Write the result as an e-mail draft: a subject line, then the body, ready to be copied. Never send anything.";
    case "document":
      return "Write the result as a structured document with Markdown headings, ready to be copied.";
    default:
      return null;
  }
}

/**
 * The first message of a run: the filled form, as the person would have typed it. `clientName`: the
 * name shown for a "client" field (its value is the client's id).
 */
export function composeRunMessage(
  fields: AgentField[],
  values: Record<string, string>,
  clientName: (id: string) => string | null,
): string {
  return fields
    .map((f) => {
      const raw = (values[f.key] ?? "").trim();
      const value = f.type === "client" ? (raw ? (clientName(raw) ?? "") : "") : raw;
      if (!value) return null;
      return f.type === "textarea" || value.includes("\n") ? `**${f.label}**\n${value}` : `**${f.label}** : ${value}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Checks a run's values against the form: required fields, known options. Returns the keys at fault. */
export function invalidRunFields(fields: AgentField[], values: Record<string, string>): string[] {
  return fields
    .filter((f) => {
      const value = (values[f.key] ?? "").trim();
      if (f.required && !value) return true;
      if (value.length > 20_000) return true;
      if (value && f.type === "select" && !(f.options ?? []).includes(value)) return true;
      return false;
    })
    .map((f) => f.key);
}

/**
 * The launch set of agents (CLAUDE.md §4.7), shown in the library. They are built in Step 7; until then
 * they are listed as "Coming soon".
 */
export const LAUNCH_AGENTS = [
  { key: "motion_design", department: "marketing" },
  { key: "video_editor", department: "marketing" },
  { key: "proposal_writer", department: "sales" },
  { key: "meeting_prep", department: "sales" },
  { key: "invoice_intake", department: "accounting" },
  { key: "payment_reminders", department: "accounting" },
  { key: "cash_flow_forecast", department: "finance" },
  { key: "margin_analysis", department: "finance" },
  { key: "job_posting_writer", department: "hr" },
  { key: "application_review", department: "hr" },
  { key: "contract_review", department: "legal" },
  { key: "template_drafter", department: "legal" },
  { key: "email_responder", department: "customer_service" },
  { key: "feedback_synthesis", department: "customer_service" },
  { key: "meeting_minutes", department: "management" },
  { key: "weekly_dashboard", department: "management" },
] as const satisfies readonly { key: string; department: Exclude<Department, "general"> }[];
