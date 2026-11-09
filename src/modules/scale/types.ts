import type { Tables } from "@/lib/supabase/database.types";

/**
 * Scale: our team's space to structure and grow Cendr (objectives → projects → milestones → tasks,
 * tests of hypotheses, strategy documents and decisions, indicators). Internal only: never shown to
 * customers. Every view reads the same records (one copy of each object).
 */

export const TASK_STATUSES = ["triage", "todo", "in_progress", "blocked", "done", "cancelled"] as const;
export const OPEN_TASK_STATUSES = ["triage", "todo", "in_progress", "blocked"] as const;
export const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export const TASK_KINDS = ["task", "idea", "feature", "bug", "feedback", "improvement", "debt"] as const;
export const PRODUCT_KINDS = ["feature", "bug", "feedback", "improvement", "debt"] as const;
export const PROJECT_STATUSES = ["planned", "active", "paused", "done", "cancelled"] as const;
export const HEALTHS = ["on_track", "at_risk", "blocked"] as const;
export const AXES = ["market", "product", "business", "acquisition", "operations"] as const;
export const HORIZONS = ["now", "next", "later"] as const;
export const OBJECTIVE_KINDS = ["numeric", "validation"] as const;
export const OBJECTIVE_STATUSES = ["active", "achieved", "missed", "dropped"] as const;
export const VALIDATION_STATES = ["pending", "validated", "not_validated"] as const;
export const TEST_STATUSES = ["to_prepare", "ready", "running", "to_analyze", "done", "abandoned"] as const;
export const TEST_CATEGORIES = ["icp", "problem", "value", "product", "price", "acquisition", "cost"] as const;
export const CONCLUSIONS = ["supported", "not_supported", "inconclusive"] as const;
export const CONTINUATIONS = ["continue", "adjust", "stop"] as const;
export const DECISION_STATUSES = ["pending", "decided", "revisited"] as const;
export const METRIC_PERIODS = ["week", "month", "quarter", "year", "total"] as const;
export const METRIC_SOURCES = ["manual", "tests_done", "tests_supported", "pilots_active", "companies_active", "ai_cost_month"] as const;
export const MEASUREMENT_KINDS = ["actual", "projection"] as const;
export const OBSERVATION_KINDS = ["fact", "quote", "measure"] as const;
export const LINK_ROLES = ["pilot", "participant", "feedback", "other"] as const;
export const RECURRENCES = ["weekly", "biweekly", "monthly"] as const;
export const COMMERCIAL_URGENCIES = ["none", "soon", "blocking"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type TaskKind = (typeof TASK_KINDS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type Health = (typeof HEALTHS)[number];
export type Axis = (typeof AXES)[number];
export type Horizon = (typeof HORIZONS)[number];
export type TestStatus = (typeof TEST_STATUSES)[number];
export type TestCategory = (typeof TEST_CATEGORIES)[number];
export type Conclusion = (typeof CONCLUSIONS)[number];
export type MetricSource = (typeof METRIC_SOURCES)[number];
export type LinkRole = (typeof LINK_ROLES)[number];
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];
export type ValidationState = (typeof VALIDATION_STATES)[number];
export type Continuation = (typeof CONTINUATIONS)[number];
export type MetricPeriod = (typeof METRIC_PERIODS)[number];
export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number];
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];
export type Recurrence = (typeof RECURRENCES)[number];
export type CommercialUrgency = (typeof COMMERCIAL_URGENCIES)[number];
export type LinkEntity = "project" | "task" | "test" | "decision";

/** Database rows, with the values the database checks narrowed to their exact lists. */
type Narrow<T, O> = Omit<T, keyof O> & O;
export type Settings = Tables<"scale_settings">;
export type Objective = Narrow<Tables<"scale_objectives">, { kind: ObjectiveKind; status: ObjectiveStatus; validation_state: ValidationState }>;
export type Project = Narrow<Tables<"scale_projects">, { status: ProjectStatus; health: Health; priority: Priority; axis: Axis | null; horizon: Horizon | null }>;
export type ProjectDep = Tables<"scale_project_dependencies">;
export type Milestone = Tables<"scale_milestones">;
export type Task = Narrow<Tables<"scale_tasks">, { status: TaskStatus; priority: Priority; kind: TaskKind; commercial_urgency: CommercialUrgency; recurrence: Recurrence | null }>;
export type TaskDep = Tables<"scale_task_dependencies">;
export type Test = Narrow<Tables<"scale_tests">, { status: TestStatus; category: TestCategory | null; conclusion: Conclusion | null; continuation: Continuation | null }>;
export type Comparison = Tables<"scale_test_comparisons">;
export type Observation = Narrow<Tables<"scale_observations">, { kind: ObservationKind }>;
export type ScaleDocument = Tables<"scale_documents">;
export type DocumentMeta = Omit<ScaleDocument, "content">;
export type Decision = Narrow<Tables<"scale_decisions">, { status: DecisionStatus }>;
export type Metric = Narrow<Tables<"scale_metrics">, { period: MetricPeriod; source: MetricSource }>;
export type Measurement = Narrow<Tables<"scale_measurements">, { kind: MeasurementKind }>;
export type Simulation = Tables<"scale_simulations">;
export type Week = Tables<"scale_weeks">;
export type WeeklyReview = Tables<"scale_weekly_reviews">;
export type CompanyLink = Narrow<Tables<"scale_company_links">, { role: LinkRole; entity_type: LinkEntity }>;
export type Comment = Tables<"scale_comments">;
export type Attachment = Tables<"scale_attachments">;
export type Activity = Tables<"scale_activity">;
export type SavedView = Tables<"scale_saved_views">;

export type TeamMember = { id: string; name: string; email: string };
/** A customer company, metadata only (the same as our console's list): never its content. */
export type CompanyRef = { id: string; name: string; status: string; planName: string | null };

/** Counted from data we already have; null when the source cannot be read. */
export type ComputedValues = Partial<Record<Exclude<MetricSource, "manual">, number | null>>;

export type ScaleSnapshot = {
  settings: Settings | null;
  objectives: Objective[];
  projects: Project[];
  projectDeps: ProjectDep[];
  milestones: Milestone[];
  tasks: Task[];
  taskDeps: TaskDep[];
  tests: Test[];
  comparisons: Comparison[];
  observations: Observation[];
  documents: DocumentMeta[];
  decisions: Decision[];
  metrics: Metric[];
  measurements: Measurement[];
  simulations: Simulation[];
  weeks: Week[];
  reviews: WeeklyReview[];
  links: CompanyLink[];
  views: SavedView[];
  recent: Activity[];
  team: TeamMember[];
  companies: CompanyRef[];
  computed: ComputedValues;
  meId: string;
  /** When this copy was read (newer copies replace older ones). */
  loadedAt: number;
};

/** The records the generic create / update / archive actions handle. */
export const ENTITIES = [
  "objective",
  "project",
  "milestone",
  "task",
  "test",
  "comparison",
  "observation",
  "document",
  "decision",
  "metric",
  "measurement",
  "simulation",
] as const;
export type Entity = (typeof ENTITIES)[number];

export type EntityRow = {
  objective: Objective;
  project: Project;
  milestone: Milestone;
  task: Task;
  test: Test;
  comparison: Comparison;
  observation: Observation;
  document: DocumentMeta;
  decision: Decision;
  metric: Metric;
  measurement: Measurement;
  simulation: Simulation;
};

/** Snapshot key of each record type. */
export const COLLECTION: { [E in Entity]: keyof ScaleSnapshot } = {
  objective: "objectives",
  project: "projects",
  milestone: "milestones",
  task: "tasks",
  test: "tests",
  comparison: "comparisons",
  observation: "observations",
  document: "documents",
  decision: "decisions",
  metric: "metrics",
  measurement: "measurements",
  simulation: "simulations",
};

export const ARCHIVABLE: Entity[] = ["objective", "project", "milestone", "task", "test", "document", "decision", "metric", "simulation"];

/** What the side panel can show (`?open=task:<id>`). */
export const PANEL_KINDS = ["task", "objective", "milestone", "decision", "company"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

export type ScaleError = "forbidden" | "not_found" | "validation" | "conflict" | "cycle" | "unknown";
export type ScaleResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ScaleError; current?: unknown };
