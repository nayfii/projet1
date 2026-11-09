import { z } from "zod";
import { isIsoDate } from "./logic/dates";
import {
  AXES,
  COMMERCIAL_URGENCIES,
  CONCLUSIONS,
  CONTINUATIONS,
  DECISION_STATUSES,
  HEALTHS,
  HORIZONS,
  MEASUREMENT_KINDS,
  METRIC_PERIODS,
  METRIC_SOURCES,
  OBJECTIVE_KINDS,
  OBJECTIVE_STATUSES,
  OBSERVATION_KINDS,
  PRIORITIES,
  PROJECT_STATUSES,
  RECURRENCES,
  TASK_KINDS,
  TASK_STATUSES,
  TEST_CATEGORIES,
  TEST_STATUSES,
  VALIDATION_STATES,
  type Entity,
} from "./types";

/** Validation of everything Scale writes (the database checks the same limits a second time). */

const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => (s.trim() === "" ? null : s))
    .nullable();
const title = (max: number) => z.string().trim().min(1).max(max);
const date = z.string().refine(isIsoDate, "date").nullable();
const monday = z
  .string()
  .refine((s) => isIsoDate(s) && new Date(`${s}T00:00:00Z`).getUTCDay() === 1, "monday")
  .nullable();
const num = z.number().finite().nullable();
const positive = z.number().finite().min(0).nullable();
const id = z.uuid().nullable();
const score = z.number().int().min(1).max(5).nullable();
const sort = z.number().finite();
const enumOrNull = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).nullable();

const FIELDS = {
  objective: {
    title: title(200),
    description: text(5000),
    kind: z.enum(OBJECTIVE_KINDS),
    metric: text(300),
    unit: text(30),
    baseline: num,
    current_value: num,
    target: num,
    metric_source: text(200),
    validation_state: z.enum(VALIDATION_STATES),
    status: z.enum(OBJECTIVE_STATUSES),
    due_date: date,
    owner_id: id,
    is_focus: z.boolean(),
    sort_order: sort,
  },
  project: {
    objective_id: id,
    title: title(200),
    outcome: text(2000),
    success_criterion: text(2000),
    description: text(20000),
    axis: enumOrNull(AXES),
    status: z.enum(PROJECT_STATUSES),
    health: z.enum(HEALTHS),
    priority: z.enum(PRIORITIES),
    horizon: enumOrNull(HORIZONS),
    owner_id: id,
    start_date: date,
    target_date: date,
    achieved_date: date,
    next_action: text(300),
    sort_order: sort,
  },
  milestone: {
    project_id: z.uuid(),
    title: title(200),
    description: text(5000),
    target_date: date,
    achieved_date: date,
    sort_order: sort,
  },
  task: {
    project_id: id,
    milestone_id: id,
    parent_id: id,
    test_id: id,
    objective_id: id,
    title: title(300),
    description: text(20000),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(PRIORITIES),
    kind: z.enum(TASK_KINDS),
    owner_id: id,
    start_date: date,
    due_date: date,
    week_start: monday,
    estimate_hours: z.number().finite().min(0).max(1000).nullable(),
    done_criterion: text(2000),
    blocked_reason: text(1000),
    impact: score,
    confidence: score,
    effort: score,
    commercial_urgency: z.enum(COMMERCIAL_URGENCIES),
    why: text(2000),
    expected_result: text(2000),
    recurrence: enumOrNull(RECURRENCES),
    sort_order: sort,
  },
  test: {
    title: title(200),
    hypothesis: text(2000),
    category: enumOrNull(TEST_CATEGORIES),
    importance: text(2000),
    protocol: text(10000),
    segment: text(1000),
    metrics: text(2000),
    baseline: text(2000),
    success_criterion: text(2000),
    start_date: date,
    end_date: date,
    owner_id: id,
    status: z.enum(TEST_STATUSES),
    results: text(20000),
    limits: text(5000),
    conclusion: enumOrNull(CONCLUSIONS),
    conclusion_note: text(5000),
    next_actions: text(5000),
    channel: text(120),
    audience: text(1000),
    budget_planned: positive,
    budget_actual: positive,
    continuation: enumOrNull(CONTINUATIONS),
    project_id: id,
    objective_id: id,
    template_key: text(60),
  },
  comparison: {
    test_id: z.uuid(),
    label: title(200),
    conditions: text(2000),
    without_minutes: positive,
    with_minutes: positive,
    without_cost: positive,
    with_cost: positive,
    without_quality: score,
    with_quality: score,
    without_corrections: z.number().int().min(0).nullable(),
    with_corrections: z.number().int().min(0).nullable(),
    notes: text(2000),
    sort_order: sort,
  },
  observation: {
    test_id: z.uuid(),
    observed_on: z.string().refine(isIsoDate, "date"),
    kind: z.enum(OBSERVATION_KINDS),
    body: title(5000),
    value: num,
    unit: text(30),
  },
  document: {
    title: title(200),
    project_id: id,
    template_key: text(60),
  },
  decision: {
    subject: title(300),
    options: text(5000),
    choice: text(2000),
    reasons: text(5000),
    evidence: text(5000),
    status: z.enum(DECISION_STATUSES),
    decided_on: date,
    review_on: date,
    review_condition: text(1000),
    owner_id: id,
    project_id: id,
    test_id: id,
    document_id: id,
  },
  metric: {
    name: title(120),
    definition: text(1000),
    unit: text(30),
    period: z.enum(METRIC_PERIODS),
    source: z.enum(METRIC_SOURCES),
    sort_order: sort,
  },
  measurement: {
    metric_id: z.uuid(),
    period_start: z.string().refine(isIsoDate, "date"),
    value: z.number().finite(),
    kind: z.enum(MEASUREMENT_KINDS),
    note: text(500),
  },
  simulation: {
    name: title(120),
    inputs: z.record(z.string().max(40), z.number().finite().nullable()).refine((o) => Object.keys(o).length <= 20, "inputs"),
    note: text(2000),
  },
} satisfies Record<Entity, z.ZodRawShape>;

/** Fields required to create each record (everything else is optional). */
const REQUIRED: Record<Entity, string[]> = {
  objective: ["title"],
  project: ["title"],
  milestone: ["project_id", "title"],
  task: ["title"],
  test: ["title"],
  comparison: ["test_id", "label"],
  observation: ["test_id", "body"],
  document: ["title"],
  decision: ["subject"],
  metric: ["name"],
  measurement: ["metric_id", "period_start", "value"],
  simulation: ["name"],
};

/** Fields set only at creation. */
const CREATE_ONLY: Partial<Record<Entity, string[]>> = {
  milestone: ["project_id"],
  comparison: ["test_id"],
  observation: ["test_id"],
  measurement: ["metric_id"],
  test: ["template_key"],
  document: ["template_key"],
};

export function createSchema(entity: Entity) {
  const shape = Object.entries(FIELDS[entity]) as [string, z.ZodType][];
  const required = new Set(REQUIRED[entity]);
  return z.strictObject(Object.fromEntries(shape.map(([k, v]) => [k, required.has(k) ? v : v.optional()])));
}

export function patchSchema(entity: Entity) {
  const shape = Object.entries(FIELDS[entity]) as [string, z.ZodType][];
  const fixed = new Set(CREATE_ONLY[entity] ?? []);
  return z
    .strictObject(Object.fromEntries(shape.filter(([k]) => !fixed.has(k)).map(([k, v]) => [k, v.optional()])))
    .refine((o) => Object.keys(o).length > 0, "empty");
}

/** What bulk actions may change on several tasks at once. */
export const bulkTaskSchema = z
  .strictObject({
    status: FIELDS.task.status.optional(),
    priority: FIELDS.task.priority.optional(),
    owner_id: FIELDS.task.owner_id.optional(),
    week_start: FIELDS.task.week_start.optional(),
    due_date: FIELDS.task.due_date.optional(),
    project_id: FIELDS.task.project_id.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty");

export const settingsSchema = z.strictObject({
  weekly_capacity_hours: z.number().finite().min(0).max(168).nullable().optional(),
  team_note: text(500).optional(),
  launch_target: date.optional(),
});

export const weekSchema = z.strictObject({
  capacity_hours: z.number().finite().min(0).max(168).nullable().optional(),
  priority_task_ids: z.array(z.uuid()).max(3).optional(),
});

export const reviewSchema = z.strictObject({
  done_summary: text(5000).optional(),
  learned: text(5000).optional(),
  blocked: text(5000).optional(),
  decisions: text(5000).optional(),
  next_priorities: text(2000).optional(),
});

export const viewSchema = z.strictObject({
  section: z.enum(["tasks", "projects", "roadmap", "tests", "product"]),
  name: title(80),
  config: z.record(z.string().max(40), z.unknown()).refine((o) => JSON.stringify(o).length <= 4000, "config"),
});

export const entityTypeSchema = z.enum(["objective", "project", "milestone", "task", "test", "decision", "document"]);
export const linkTypeSchema = z.enum(["project", "task", "test", "decision"]);
