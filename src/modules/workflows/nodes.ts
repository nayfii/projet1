/**
 * The workflow node catalogue (CLAUDE.md §12): what each node does, its settings, its exits, and what it
 * needs. Shared by the editor (library, settings, validation), the copilot (what it may add) and the
 * engine (server/engine.ts runs each type). A node that needs a connected app is offered only when such a
 * connection exists; a node not built yet is shown "Bientôt" and cannot be added.
 */

export type NodeCategory = "trigger" | "ai" | "apps" | "logic" | "action";

export type FieldKind = "text" | "textarea" | "select" | "number" | "connection" | "time" | "model" | "space" | "workflow" | "list";

export type FieldDef = {
  key: string;
  kind: FieldKind;
  required?: boolean;
  /** Text that may hold {{variables}}. */
  template?: boolean;
  options?: readonly string[];
  /** For "connection": the apps a connection must have (any of them). */
  apps?: readonly string[];
  min?: number;
  max?: number;
};

/** What turning a workflow on may do without asking again (shown before Play). */
export type Sensitivity = "external_message" | "publish" | "modify";

export type NodeDef = {
  type: string;
  category: NodeCategory;
  status: "available" | "soon";
  fields: FieldDef[];
  /** Exits: most nodes have one ("out"); conditions have "true"/"false"; loops "each"/"done". */
  handles: readonly string[];
  /** Capability per connected app (gmail → gmail.send…), for nodes that act through a connection. */
  capabilities?: Record<string, string>;
  sensitivity?: Sensitivity;
  /** Can fail without stopping the run ("continue on error"). */
  canContinue?: boolean;
};

const OUT = ["out"] as const;
const BRANCH = ["true", "false"] as const;
const OPERATORS = ["equals", "not_equals", "contains", "not_contains", "is_empty", "not_empty", "greater", "less"] as const;
const MAIL_APPS = ["gmail", "outlook"] as const;
const FILE_APPS = ["drive", "onedrive", "notion"] as const;
const CALENDAR_APPS = ["calendar", "outlook_calendar"] as const;

export const NODES: NodeDef[] = [
  // ─── Triggers ───
  { type: "trigger.manual", category: "trigger", status: "available", handles: OUT, fields: [{ key: "sample", kind: "textarea" }] },
  {
    type: "trigger.schedule",
    category: "trigger",
    status: "available",
    handles: OUT,
    fields: [
      { key: "frequency", kind: "select", required: true, options: ["hourly", "daily", "weekdays", "weekly"] },
      { key: "time", kind: "time" },
      { key: "weekday", kind: "select", options: ["1", "2", "3", "4", "5", "6", "0"] },
    ],
  },
  { type: "trigger.email", category: "trigger", status: "available", handles: OUT, fields: [{ key: "connection", kind: "connection", required: true, apps: MAIL_APPS }, { key: "query", kind: "text" }], capabilities: { gmail: "gmail.search", outlook: "outlook.search" } },
  { type: "trigger.webhook", category: "trigger", status: "available", handles: OUT, fields: [] },
  { type: "trigger.document", category: "trigger", status: "soon", handles: OUT, fields: [] },
  { type: "trigger.slack", category: "trigger", status: "soon", handles: OUT, fields: [] },
  { type: "trigger.calendar", category: "trigger", status: "soon", handles: OUT, fields: [] },

  // ─── AI ───
  { type: "ai.generate", category: "ai", status: "available", handles: OUT, canContinue: true, fields: [{ key: "prompt", kind: "textarea", required: true, template: true }, { key: "model", kind: "model" }] },
  { type: "ai.summarize", category: "ai", status: "available", handles: OUT, canContinue: true, fields: [{ key: "input", kind: "textarea", required: true, template: true }, { key: "length", kind: "select", options: ["short", "medium", "long"] }, { key: "model", kind: "model" }] },
  { type: "ai.classify", category: "ai", status: "available", handles: OUT, canContinue: true, fields: [{ key: "input", kind: "textarea", required: true, template: true }, { key: "labels", kind: "list", required: true }, { key: "model", kind: "model" }] },
  { type: "ai.extract", category: "ai", status: "available", handles: OUT, canContinue: true, fields: [{ key: "input", kind: "textarea", required: true, template: true }, { key: "fields", kind: "list", required: true }, { key: "model", kind: "model" }] },
  { type: "ai.decide", category: "ai", status: "available", handles: BRANCH, fields: [{ key: "question", kind: "text", required: true, template: true }, { key: "input", kind: "textarea", template: true }, { key: "model", kind: "model" }] },
  { type: "ai.memory", category: "ai", status: "available", handles: OUT, canContinue: true, fields: [{ key: "query", kind: "text", required: true, template: true }, { key: "limit", kind: "number", min: 1, max: 10 }] },

  // ─── Connected apps (read) ───
  { type: "app.search_email", category: "apps", status: "available", handles: OUT, canContinue: true, fields: [{ key: "connection", kind: "connection", required: true, apps: MAIL_APPS }, { key: "query", kind: "text", template: true }, { key: "limit", kind: "number", min: 1, max: 25 }], capabilities: { gmail: "gmail.search", outlook: "outlook.search" } },
  { type: "app.search_files", category: "apps", status: "available", handles: OUT, canContinue: true, fields: [{ key: "connection", kind: "connection", required: true, apps: FILE_APPS }, { key: "query", kind: "text", template: true }, { key: "limit", kind: "number", min: 1, max: 25 }], capabilities: { drive: "drive.search", onedrive: "onedrive.search", notion: "notion.search" } },
  { type: "app.read_file", category: "apps", status: "available", handles: OUT, canContinue: true, fields: [{ key: "connection", kind: "connection", required: true, apps: FILE_APPS }, { key: "file", kind: "text", required: true, template: true }], capabilities: { drive: "drive.read", onedrive: "onedrive.read", notion: "notion.read" } },
  { type: "app.calendar_events", category: "apps", status: "available", handles: OUT, canContinue: true, fields: [{ key: "connection", kind: "connection", required: true, apps: CALENDAR_APPS }, { key: "days", kind: "number", min: 1, max: 31 }], capabilities: { calendar: "calendar.events", outlook_calendar: "outlook_calendar.events" } },

  // ─── Logic ───
  { type: "logic.condition", category: "logic", status: "available", handles: BRANCH, fields: [{ key: "left", kind: "text", required: true, template: true }, { key: "operator", kind: "select", required: true, options: OPERATORS }, { key: "right", kind: "text", template: true }] },
  { type: "logic.filter", category: "logic", status: "available", handles: OUT, fields: [{ key: "left", kind: "text", required: true, template: true }, { key: "operator", kind: "select", required: true, options: OPERATORS }, { key: "right", kind: "text", template: true }] },
  { type: "logic.set", category: "logic", status: "available", handles: OUT, fields: [{ key: "name", kind: "text", required: true }, { key: "value", kind: "textarea", template: true }] },
  { type: "logic.transform", category: "logic", status: "available", handles: OUT, fields: [{ key: "template", kind: "textarea", required: true, template: true }, { key: "operation", kind: "select", options: ["none", "uppercase", "lowercase", "trim", "first_line"] }] },
  { type: "logic.loop", category: "logic", status: "available", handles: ["each", "done"], fields: [{ key: "items", kind: "text", required: true, template: true }, { key: "max", kind: "number", min: 1, max: 50 }] },
  { type: "logic.delay", category: "logic", status: "available", handles: OUT, fields: [{ key: "amount", kind: "number", required: true, min: 1, max: 1440 }, { key: "unit", kind: "select", options: ["minutes", "hours"] }] },

  // ─── Actions ───
  { type: "action.email_draft", category: "action", status: "available", handles: OUT, canContinue: true, fields: [{ key: "connection", kind: "connection", required: true, apps: MAIL_APPS }, { key: "to", kind: "text", required: true, template: true }, { key: "subject", kind: "text", required: true, template: true }, { key: "body", kind: "textarea", required: true, template: true }], capabilities: { gmail: "gmail.draft", outlook: "outlook.draft" } },
  { type: "action.email_send", category: "action", status: "available", handles: OUT, canContinue: true, sensitivity: "external_message", fields: [{ key: "connection", kind: "connection", required: true, apps: MAIL_APPS }, { key: "to", kind: "text", required: true, template: true }, { key: "subject", kind: "text", required: true, template: true }, { key: "body", kind: "textarea", required: true, template: true }], capabilities: { gmail: "gmail.send", outlook: "outlook.send" } },
  { type: "action.slack_post", category: "action", status: "available", handles: OUT, canContinue: true, sensitivity: "publish", fields: [{ key: "connection", kind: "connection", required: true, apps: ["slack"] }, { key: "channel", kind: "text", required: true }, { key: "text", kind: "textarea", required: true, template: true }], capabilities: { slack: "slack.post" } },
  { type: "action.teams_post", category: "action", status: "available", handles: OUT, canContinue: true, sensitivity: "publish", fields: [{ key: "connection", kind: "connection", required: true, apps: ["teams"] }, { key: "team", kind: "text", required: true }, { key: "channel", kind: "text", required: true }, { key: "text", kind: "textarea", required: true, template: true }], capabilities: { teams: "teams.post" } },
  { type: "action.notion_page", category: "action", status: "available", handles: OUT, canContinue: true, sensitivity: "modify", fields: [{ key: "connection", kind: "connection", required: true, apps: ["notion"] }, { key: "parent", kind: "text", required: true }, { key: "title", kind: "text", required: true, template: true }, { key: "text", kind: "textarea", template: true }], capabilities: { notion: "notion.create_page" } },
  { type: "action.calendar_event", category: "action", status: "available", handles: OUT, canContinue: true, sensitivity: "external_message", fields: [{ key: "connection", kind: "connection", required: true, apps: CALENDAR_APPS }, { key: "title", kind: "text", required: true, template: true }, { key: "start", kind: "text", required: true, template: true }, { key: "duration", kind: "number", min: 5, max: 1440 }, { key: "attendees", kind: "text", template: true }], capabilities: { calendar: "calendar.create_event", outlook_calendar: "outlook_calendar.create_event" } },
  { type: "action.canva_design", category: "action", status: "available", handles: OUT, canContinue: true, fields: [{ key: "connection", kind: "connection", required: true, apps: ["canva"] }, { key: "title", kind: "text", required: true, template: true }, { key: "kind", kind: "select", options: ["presentation", "doc", "whiteboard"] }], capabilities: { canva: "canva.create" } },
  { type: "action.memory_entry", category: "action", status: "available", handles: OUT, canContinue: true, sensitivity: "modify", fields: [{ key: "space", kind: "space", required: true }, { key: "title", kind: "text", required: true, template: true }, { key: "content", kind: "textarea", required: true, template: true }] },
  { type: "action.run_workflow", category: "action", status: "available", handles: OUT, fields: [{ key: "workflow", kind: "workflow", required: true }, { key: "input", kind: "textarea", template: true }] },
  { type: "action.crm_update", category: "action", status: "soon", handles: OUT, fields: [] },
];

export const NODE_BY_TYPE = new Map(NODES.map((n) => [n.type, n]));
export const CATEGORIES: NodeCategory[] = ["trigger", "ai", "apps", "logic", "action"];

export function nodeDef(type: string): NodeDef | undefined {
  return NODE_BY_TYPE.get(type);
}

/** Limits that keep a run bounded: nodes per workflow, loop items, run length. */
export const WORKFLOW_LIMITS = { nodes: 50, loopItems: 50, steps: 400, delayMinutes: 1440, chainDepth: 3, stepTimeoutMs: 60_000 } as const;
