import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AppContext } from "@/lib/auth/context";
import type { CompanyLink, CompanyRef, ComputedValues, Decision, DocumentMeta, Measurement, Metric, Objective, Observation, Project, ScaleSnapshot, Task, TeamMember, Test } from "../types";

/** Document columns without their content (opened one at a time). */
export const DOCUMENT_META = "id, title, template_key, project_id, created_by, updated_by, created_at, updated_at, archived_at";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Everything Scale shows, in one read (our team's internal data is small). Row Level Security lets
 * only platform admins read these tables; callers have checked that already.
 */
export async function getScaleSnapshot(ctx: AppContext, client?: Client): Promise<ScaleSnapshot> {
  const supabase = client ?? (await createClient());
  const [
    settings,
    objectives,
    projects,
    projectDeps,
    milestones,
    tasks,
    taskDeps,
    tests,
    comparisons,
    observations,
    documents,
    decisions,
    metrics,
    measurements,
    simulations,
    weeks,
    reviews,
    links,
    views,
    recent,
    team,
    companies,
    dashboard,
  ] = await Promise.all([
    supabase.from("scale_settings").select("*").maybeSingle(),
    supabase.from("scale_objectives").select("*").order("sort_order").order("created_at"),
    supabase.from("scale_projects").select("*").order("sort_order").order("created_at"),
    supabase.from("scale_project_dependencies").select("*"),
    supabase.from("scale_milestones").select("*").order("target_date", { nullsFirst: false }).order("sort_order"),
    supabase.from("scale_tasks").select("*").order("sort_order").order("created_at"),
    supabase.from("scale_task_dependencies").select("*"),
    supabase.from("scale_tests").select("*").order("created_at"),
    supabase.from("scale_test_comparisons").select("*").order("sort_order").order("created_at"),
    supabase.from("scale_observations").select("*").order("observed_on").order("created_at"),
    supabase.from("scale_documents").select(DOCUMENT_META).order("updated_at", { ascending: false }),
    supabase.from("scale_decisions").select("*").order("created_at", { ascending: false }),
    supabase.from("scale_metrics").select("*").order("sort_order").order("created_at"),
    supabase.from("scale_measurements").select("*").order("period_start"),
    supabase.from("scale_simulations").select("*").order("created_at"),
    supabase.from("scale_weeks").select("*"),
    supabase.from("scale_weekly_reviews").select("*").order("week_start", { ascending: false }),
    supabase.from("scale_company_links").select("*"),
    supabase.from("scale_saved_views").select("*").order("created_at"),
    supabase.from("scale_activity").select("*").order("created_at", { ascending: false }).limit(60),
    supabase.rpc("platform_team"),
    supabase.rpc("platform_list_companies"),
    supabase.rpc("platform_dashboard", { p_tz: "Europe/Paris" }),
  ]);

  const teamRows: TeamMember[] = (team.data ?? []).map((m) => ({ id: m.user_id, name: m.full_name || m.email, email: m.email }));
  const companyRows: CompanyRef[] = (companies.data ?? []).map((c) => ({ id: c.id, name: c.name, status: c.status, planName: c.plan_name ?? null }));
  const testRows = (tests.data ?? []) as Test[];
  const linkRows = (links.data ?? []) as CompanyLink[];

  // Indicators counted from data we already have (never invented: null when the source is unreadable).
  const d = dashboard.error ? null : (dashboard.data as { companies?: { active?: number }; month?: { cost_usd?: number } } | null);
  const activeCompanies = new Set(companyRows.filter((c) => c.status === "active").map((c) => c.id));
  const computed: ComputedValues = {
    tests_done: testRows.filter((t) => !t.archived_at && t.status === "done").length,
    tests_supported: testRows.filter((t) => !t.archived_at && t.conclusion === "supported").length,
    pilots_active: companies.error ? null : new Set(linkRows.filter((l) => l.role === "pilot" && activeCompanies.has(l.company_id)).map((l) => l.company_id)).size,
    companies_active: typeof d?.companies?.active === "number" ? d.companies.active : null,
    ai_cost_month: typeof d?.month?.cost_usd === "number" ? Math.round(d.month.cost_usd * 100) / 100 : null,
  };

  return {
    settings: settings.data ?? null,
    objectives: (objectives.data ?? []) as Objective[],
    projects: (projects.data ?? []) as Project[],
    projectDeps: projectDeps.data ?? [],
    milestones: milestones.data ?? [],
    tasks: (tasks.data ?? []) as Task[],
    taskDeps: taskDeps.data ?? [],
    tests: testRows,
    comparisons: comparisons.data ?? [],
    observations: (observations.data ?? []) as Observation[],
    documents: (documents.data ?? []) as DocumentMeta[],
    decisions: (decisions.data ?? []) as Decision[],
    metrics: (metrics.data ?? []) as Metric[],
    measurements: (measurements.data ?? []) as Measurement[],
    simulations: simulations.data ?? [],
    weeks: weeks.data ?? [],
    reviews: reviews.data ?? [],
    links: linkRows,
    views: views.data ?? [],
    recent: recent.data ?? [],
    team: teamRows,
    companies: companyRows,
    computed,
    meId: ctx.user.id,
    loadedAt: Date.now(),
  };
}
