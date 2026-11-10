-- ════════════════════════════════════════════════════════════════════════════
-- Scale: our team's space to structure and grow Cendr (founder's request, 2026-11-09).
-- Purely additive: new tables only, nothing existing is changed. Our team only (platform admins):
-- customers never see any of it. Links to customers use the existing company ids, never a copy.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Settings (one row) ─────────────────────────────────────────────────────
create table public.scale_settings (
  id boolean primary key default true check (id),
  onboarded_at timestamptz,
  weekly_capacity_hours numeric(5,1) check (weekly_capacity_hours between 0 and 168),
  team_note text check (length(team_note) <= 500),
  launch_target date,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- ─── Objectives → projects → milestones → tasks → sub-tasks ─────────────────
create table public.scale_objectives (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (length(description) <= 5000),
  kind text not null default 'validation' check (kind in ('numeric', 'validation')),
  metric text check (length(metric) <= 300),
  unit text check (length(unit) <= 30),
  baseline numeric,
  current_value numeric,
  target numeric,
  metric_source text check (length(metric_source) <= 200),
  metric_updated_at timestamptz,
  validation_state text not null default 'pending' check (validation_state in ('pending', 'validated', 'not_validated')),
  status text not null default 'active' check (status in ('active', 'achieved', 'missed', 'dropped')),
  due_date date,
  owner_id uuid references public.profiles (id) on delete set null,
  is_focus boolean not null default false,
  sort_order double precision not null default 0,
  template_key text check (length(template_key) <= 60),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index scale_objectives_one_focus on public.scale_objectives ((true)) where is_focus and archived_at is null;

create table public.scale_projects (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid references public.scale_objectives (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 200),
  outcome text check (length(outcome) <= 2000),
  success_criterion text check (length(success_criterion) <= 2000),
  description text check (length(description) <= 20000),
  axis text check (axis in ('market', 'product', 'business', 'acquisition', 'operations')),
  status text not null default 'planned' check (status in ('planned', 'active', 'paused', 'done', 'cancelled')),
  health text not null default 'on_track' check (health in ('on_track', 'at_risk', 'blocked')),
  priority text not null default 'none' check (priority in ('urgent', 'high', 'medium', 'low', 'none')),
  horizon text check (horizon in ('now', 'next', 'later')),
  owner_id uuid references public.profiles (id) on delete set null,
  start_date date,
  target_date date,
  achieved_date date,
  next_action text check (length(next_action) <= 300),
  sort_order double precision not null default 0,
  template_key text check (length(template_key) <= 60),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (start_date is null or target_date is null or start_date <= target_date)
);
create index scale_projects_objective on public.scale_projects (objective_id);

create table public.scale_project_dependencies (
  project_id uuid not null references public.scale_projects (id) on delete cascade,
  depends_on_id uuid not null references public.scale_projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, depends_on_id),
  check (project_id <> depends_on_id)
);

create table public.scale_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.scale_projects (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (length(description) <= 5000),
  target_date date,
  achieved_date date,
  sort_order double precision not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index scale_milestones_project on public.scale_milestones (project_id);

-- ─── Tests (hypotheses) ─────────────────────────────────────────────────────
create table public.scale_tests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  hypothesis text check (length(hypothesis) <= 2000),
  category text check (category in ('icp', 'problem', 'value', 'product', 'price', 'acquisition', 'cost')),
  importance text check (length(importance) <= 2000),
  protocol text check (length(protocol) <= 10000),
  segment text check (length(segment) <= 1000),
  metrics text check (length(metrics) <= 2000),
  baseline text check (length(baseline) <= 2000),
  success_criterion text check (length(success_criterion) <= 2000),
  start_date date,
  end_date date,
  started_at timestamptz,
  owner_id uuid references public.profiles (id) on delete set null,
  status text not null default 'to_prepare' check (status in ('to_prepare', 'ready', 'running', 'to_analyze', 'done', 'abandoned')),
  results text check (length(results) <= 20000),
  limits text check (length(limits) <= 5000),
  -- The conclusion is never derived from the status: a person chooses it.
  conclusion text check (conclusion in ('supported', 'not_supported', 'inconclusive')),
  conclusion_note text check (length(conclusion_note) <= 5000),
  next_actions text check (length(next_actions) <= 5000),
  channel text check (length(channel) <= 120),
  audience text check (length(audience) <= 1000),
  budget_planned numeric check (budget_planned >= 0),
  budget_actual numeric check (budget_actual >= 0),
  continuation text check (continuation in ('continue', 'adjust', 'stop')),
  project_id uuid references public.scale_projects (id) on delete set null,
  objective_id uuid references public.scale_objectives (id) on delete set null,
  template_key text check (length(template_key) <= 60),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (start_date is null or end_date is null or start_date <= end_date)
);
create index scale_tests_project on public.scale_tests (project_id);

-- A task compared with and without Cendr, in stated conditions.
create table public.scale_test_comparisons (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.scale_tests (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 200),
  conditions text check (length(conditions) <= 2000),
  without_minutes numeric check (without_minutes >= 0),
  with_minutes numeric check (with_minutes >= 0),
  without_cost numeric check (without_cost >= 0),
  with_cost numeric check (with_cost >= 0),
  without_quality smallint check (without_quality between 1 and 5),
  with_quality smallint check (with_quality between 1 and 5),
  without_corrections integer check (without_corrections >= 0),
  with_corrections integer check (with_corrections >= 0),
  notes text check (length(notes) <= 2000),
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scale_test_comparisons_test on public.scale_test_comparisons (test_id);

create table public.scale_observations (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.scale_tests (id) on delete cascade,
  observed_on date not null default current_date,
  kind text not null default 'fact' check (kind in ('fact', 'quote', 'measure')),
  body text not null check (length(trim(body)) between 1 and 5000),
  value numeric,
  unit text check (length(unit) <= 30),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scale_observations_test on public.scale_observations (test_id, observed_on);

create table public.scale_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.scale_projects (id) on delete set null,
  milestone_id uuid references public.scale_milestones (id) on delete set null,
  parent_id uuid references public.scale_tasks (id) on delete cascade,
  test_id uuid references public.scale_tests (id) on delete set null,
  objective_id uuid references public.scale_objectives (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 300),
  description text check (length(description) <= 20000),
  status text not null default 'triage' check (status in ('triage', 'todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority text not null default 'none' check (priority in ('urgent', 'high', 'medium', 'low', 'none')),
  kind text not null default 'task' check (kind in ('task', 'idea', 'feature', 'bug', 'feedback', 'improvement', 'debt')),
  owner_id uuid references public.profiles (id) on delete set null,
  start_date date,
  due_date date,
  -- The week the work is planned for (a Monday), separate from the due date.
  week_start date check (week_start is null or extract(isodow from week_start) = 1),
  -- An estimate, in hours of work; never turned into calendar time.
  estimate_hours numeric(6,2) check (estimate_hours between 0 and 1000),
  done_criterion text check (length(done_criterion) <= 2000),
  blocked_reason text check (length(blocked_reason) <= 1000),
  impact smallint check (impact between 1 and 5),
  confidence smallint check (confidence between 1 and 5),
  effort smallint check (effort between 1 and 5),
  commercial_urgency text not null default 'none' check (commercial_urgency in ('none', 'soon', 'blocking')),
  why text check (length(why) <= 2000),
  expected_result text check (length(expected_result) <= 2000),
  recurrence text check (recurrence in ('weekly', 'biweekly', 'monthly')),
  sort_order double precision not null default 0,
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (start_date is null or due_date is null or start_date <= due_date),
  check (parent_id is null or parent_id <> id)
);
create index scale_tasks_project on public.scale_tasks (project_id);
create index scale_tasks_parent on public.scale_tasks (parent_id);
create index scale_tasks_week on public.scale_tasks (week_start);

create table public.scale_task_dependencies (
  task_id uuid not null references public.scale_tasks (id) on delete cascade,
  depends_on_id uuid not null references public.scale_tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

-- ─── Strategy: documents and decisions ──────────────────────────────────────
create table public.scale_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  template_key text check (length(template_key) <= 60),
  -- Blocks (heading, paragraph, list, checklist, table, link, hypothesis / fact / decision…).
  content jsonb not null default '[]' check (jsonb_typeof(content) = 'array' and octet_length(content::text) <= 600000),
  project_id uuid references public.scale_projects (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.scale_decisions (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (length(trim(subject)) between 1 and 300),
  options text check (length(options) <= 5000),
  choice text check (length(choice) <= 2000),
  reasons text check (length(reasons) <= 5000),
  evidence text check (length(evidence) <= 5000),
  status text not null default 'pending' check (status in ('pending', 'decided', 'revisited')),
  decided_on date,
  review_on date,
  review_condition text check (length(review_condition) <= 1000),
  owner_id uuid references public.profiles (id) on delete set null,
  project_id uuid references public.scale_projects (id) on delete set null,
  test_id uuid references public.scale_tests (id) on delete set null,
  document_id uuid references public.scale_documents (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ─── Indicators: definitions and dated values (actual or projected) ─────────
create table public.scale_metrics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  definition text check (length(definition) <= 1000),
  unit text check (length(unit) <= 30),
  period text not null default 'month' check (period in ('week', 'month', 'quarter', 'year', 'total')),
  -- 'manual' is typed by our team; the others are counted from data we already have.
  source text not null default 'manual' check (source in ('manual', 'tests_done', 'tests_supported', 'pilots_active', 'companies_active', 'ai_cost_month')),
  sort_order double precision not null default 0,
  template_key text check (length(template_key) <= 60),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.scale_measurements (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.scale_metrics (id) on delete cascade,
  period_start date not null,
  value numeric not null,
  kind text not null default 'actual' check (kind in ('actual', 'projection')),
  note text check (length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (metric_id, period_start, kind)
);

create table public.scale_simulations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  inputs jsonb not null default '{}' check (jsonb_typeof(inputs) = 'object' and octet_length(inputs::text) <= 5000),
  note text check (length(note) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ─── Weeks: capacity, the week's priorities, and the weekly review ──────────
create table public.scale_weeks (
  week_start date primary key check (extract(isodow from week_start) = 1),
  capacity_hours numeric(5,1) check (capacity_hours between 0 and 168),
  priority_task_ids uuid[] not null default '{}' check (cardinality(priority_task_ids) <= 3),
  updated_at timestamptz not null default now()
);

create table public.scale_weekly_reviews (
  week_start date primary key check (extract(isodow from week_start) = 1),
  done_summary text check (length(done_summary) <= 5000),
  learned text check (length(learned) <= 5000),
  blocked text check (length(blocked) <= 5000),
  decisions text check (length(decisions) <= 5000),
  next_priorities text check (length(next_priorities) <= 2000),
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ─── Links to existing customer companies (ids only, never a copy) ──────────
create table public.scale_company_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  entity_type text not null check (entity_type in ('project', 'task', 'test', 'decision')),
  entity_id uuid not null,
  role text not null default 'other' check (role in ('pilot', 'participant', 'feedback', 'other')),
  note text check (length(note) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, entity_type, entity_id)
);
create index scale_company_links_entity on public.scale_company_links (entity_type, entity_id);

-- ─── Comments, links and files, activity, saved views ───────────────────────
create table public.scale_comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('objective', 'project', 'milestone', 'task', 'test', 'decision', 'document')),
  entity_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scale_comments_entity on public.scale_comments (entity_type, entity_id, created_at);

create table public.scale_attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('objective', 'project', 'milestone', 'task', 'test', 'decision', 'document')),
  entity_id uuid not null,
  kind text not null check (kind in ('link', 'file')),
  label text not null check (length(trim(label)) between 1 and 200),
  url text check (url is null or (url ~ '^https?://' and length(url) <= 2000)),
  storage_path text check (length(storage_path) <= 400),
  mime_type text check (length(mime_type) <= 120),
  size_bytes integer check (size_bytes >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'link' and url is not null) or (kind = 'file' and storage_path is not null))
);
create index scale_attachments_entity on public.scale_attachments (entity_type, entity_id);

create table public.scale_activity (
  id bigint generated always as identity primary key,
  entity_type text not null check (length(entity_type) <= 30),
  entity_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (length(action) <= 60),
  details jsonb not null default '{}' check (octet_length(details::text) <= 8000),
  created_at timestamptz not null default now()
);
create index scale_activity_entity on public.scale_activity (entity_type, entity_id, created_at desc);
create index scale_activity_recent on public.scale_activity (created_at desc);

create table public.scale_saved_views (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  section text not null check (section in ('tasks', 'projects', 'roadmap', 'tests', 'product')),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 4000),
  owner_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ─── updated_at ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['scale_objectives', 'scale_projects', 'scale_milestones', 'scale_tests', 'scale_test_comparisons',
    'scale_observations', 'scale_tasks', 'scale_documents', 'scale_decisions', 'scale_metrics', 'scale_measurements',
    'scale_simulations', 'scale_weeks', 'scale_weekly_reviews', 'scale_comments', 'scale_settings']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ─── Access: our team only (platform admins), checked again here ───────────
do $$
declare t text;
begin
  foreach t in array array['scale_settings', 'scale_objectives', 'scale_projects', 'scale_project_dependencies', 'scale_milestones',
    'scale_tests', 'scale_test_comparisons', 'scale_observations', 'scale_tasks', 'scale_task_dependencies', 'scale_documents',
    'scale_decisions', 'scale_metrics', 'scale_measurements', 'scale_simulations', 'scale_weeks', 'scale_weekly_reviews',
    'scale_company_links', 'scale_comments', 'scale_attachments', 'scale_activity', 'scale_saved_views']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()))', t || '_team', t);
  end loop;
end $$;
-- The activity history is written, never rewritten.
revoke update on public.scale_activity from authenticated;

-- ─── Files attached in Scale: private bucket, our team only ─────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('scale-files', 'scale-files', false, 10 * 1024 * 1024)
on conflict (id) do nothing;
create policy scale_files_select on storage.objects
  for select to authenticated using (bucket_id = 'scale-files' and (select private.is_platform_admin()));
create policy scale_files_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'scale-files' and (select private.is_platform_admin()));
create policy scale_files_delete on storage.objects
  for delete to authenticated using (bucket_id = 'scale-files' and (select private.is_platform_admin()));
