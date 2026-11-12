-- AI workflows (CLAUDE.md §12, V1.1): a visual graph of nodes (trigger → AI steps, logic, actions on
-- connected apps), a draft edited freely, immutable versions made at activation (Play), and a real
-- execution engine with a queue of runs and their steps.
--
-- - A workflow belongs to its author (personal) or to the company (shared, edited by its author and by
--   the Owner / Admins with the "models" scope). It always RUNS WITH ITS AUTHOR'S RIGHTS: connections,
--   memories and credits are checked for that person at every run, on our server.
-- - Runs read what their author may read; nobody else in the company sees a personal workflow's runs.
-- - Our team (platform admins) sees nothing here.

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  scope text not null default 'personal' check (scope in ('personal', 'company')),
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  template_key text check (length(template_key) <= 60),
  draft jsonb not null default '{"nodes":[],"edges":[]}' check (pg_column_size(draft) <= 400000),
  draft_revision integer not null default 0,
  status text not null default 'paused' check (status in ('paused', 'active')),
  active_version_id uuid,
  -- Scheduling and polling triggers: when the next automatic run is due; what the last poll saw.
  next_run_at timestamptz,
  trigger_state jsonb not null default '{}',
  -- Webhook trigger: SHA-256 of the secret (the secret itself is shown once).
  webhook_secret_hash text check (length(webhook_secret_hash) = 64),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workflows_company on public.workflows (company_id, updated_at desc);
create index workflows_due on public.workflows (next_run_at) where status = 'active';
create trigger workflows_updated_at before update on public.workflows for each row execute function private.touch_updated_at();

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  version integer not null,
  graph jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workflow_id, version)
);
alter table public.workflows add foreign key (active_version_id) references public.workflow_versions (id) on delete set null;

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  version_id uuid references public.workflow_versions (id) on delete set null,
  -- Test runs use the draft as it was when the test started (kept here, not the live draft).
  graph jsonb,
  mode text not null check (mode in ('live', 'test')),
  trigger text not null check (trigger in ('manual', 'schedule', 'webhook', 'email', 'workflow', 'test')),
  triggered_by uuid references public.profiles (id) on delete set null,
  -- Prevents duplicates: the same e-mail, webhook delivery or schedule slot runs once.
  idempotency_key text check (length(idempotency_key) <= 200),
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
  input jsonb not null default '{}' check (pg_column_size(input) <= 200000),
  -- Where a waiting run continues (a delay node), and when.
  resume_at timestamptz,
  attempt integer not null default 0,
  error_code text check (length(error_code) <= 60),
  error_node text check (length(error_node) <= 60),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_until timestamptz
);
create unique index workflow_runs_idempotent on public.workflow_runs (workflow_id, idempotency_key) where idempotency_key is not null;
create index workflow_runs_workflow on public.workflow_runs (workflow_id, created_at desc);
create index workflow_runs_pending on public.workflow_runs (status, resume_at) where status in ('queued', 'waiting', 'running');

create table public.workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  node_id text not null check (length(node_id) <= 60),
  node_type text not null check (length(node_type) <= 60),
  iteration integer not null default 0,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped', 'simulated')),
  output jsonb check (pg_column_size(output) <= 100000),
  error_code text check (length(error_code) <= 60),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  unique (run_id, node_id, iteration)
);

alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;
revoke all on public.workflows, public.workflow_versions, public.workflow_runs, public.workflow_run_steps from anon, authenticated;
grant select on public.workflows, public.workflow_versions, public.workflow_runs, public.workflow_run_steps to authenticated;
-- Signed-in people write the draft and the name only; status, versions and runs go through our server.
grant insert (company_id, scope, name, description, template_key, draft) on public.workflows to authenticated;
grant update (name, description, draft, draft_revision) on public.workflows to authenticated;
grant delete on public.workflows to authenticated;

create function private.can_see_workflow(p_workflow uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workflows w
    join public.company_members m on m.company_id = w.company_id and m.user_id = p_user and m.status = 'active'
    join public.companies c on c.id = w.company_id and c.status = 'active'
    where w.id = p_workflow
      and (w.owner_id = p_user or w.scope = 'company' or m.role = 'owner' or (m.role = 'admin' and 'models' = any (m.admin_scopes)))
  );
$$;

create function private.can_edit_workflow(p_workflow uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workflows w
    join public.company_members m on m.company_id = w.company_id and m.user_id = p_user and m.status = 'active'
    join public.companies c on c.id = w.company_id and c.status = 'active'
    where w.id = p_workflow
      and (w.owner_id = p_user or (w.scope = 'company' and (m.role = 'owner' or (m.role = 'admin' and 'models' = any (m.admin_scopes)))))
  );
$$;

-- Personal workflows: their author only (the Owner sees that they exist, never their runs' content).
-- Written on the row's own columns (not by re-reading the table), so a new workflow is visible to its
-- author in the same statement (insert … returning).
create policy workflows_read on public.workflows for select to authenticated using (
  private.is_company_member(company_id)
  and (owner_id = (select auth.uid()) or scope = 'company' or private.has_admin_scope(company_id, 'models'))
);
create policy workflows_insert on public.workflows for insert to authenticated with check (
  private.is_company_member(company_id) and owner_id = (select auth.uid())
  and (scope = 'personal' or private.has_admin_scope(company_id, 'models'))
);
create policy workflows_update on public.workflows for update to authenticated
  using (private.is_company_member(company_id) and (owner_id = (select auth.uid()) or (scope = 'company' and private.has_admin_scope(company_id, 'models'))))
  with check (private.is_company_member(company_id) and (owner_id = (select auth.uid()) or (scope = 'company' and private.has_admin_scope(company_id, 'models'))));
create policy workflows_delete on public.workflows for delete to authenticated
  using (private.is_company_member(company_id) and (owner_id = (select auth.uid()) or (scope = 'company' and private.has_admin_scope(company_id, 'models'))));

create policy workflow_versions_read on public.workflow_versions for select to authenticated using (private.can_edit_workflow(workflow_id, (select auth.uid())));
-- Runs and their steps: the workflow's author, and the editors of a company workflow.
create policy workflow_runs_read on public.workflow_runs for select to authenticated using (private.can_edit_workflow(workflow_id, (select auth.uid())));
create policy workflow_run_steps_read on public.workflow_run_steps for select to authenticated using (
  exists (select 1 from public.workflow_runs r where r.id = run_id and private.can_edit_workflow(r.workflow_id, (select auth.uid())))
);

-- ─── For the engine (service role only): the author's rights, checked at every run ────────────────
create function public.workflow_quota_status(p_company uuid, p_user uuid)
returns table (period_start timestamptz, company_limit numeric, company_used numeric, user_limit numeric, user_used numeric)
language sql stable security definer set search_path = '' as $$
  select * from private.quota_status(p_company, p_user);
$$;

create function public.workflow_member_spaces(p_company uuid, p_user uuid, p_write boolean)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.memory_spaces s
  where s.company_id = p_company and private.user_space_right(s.id, p_user, p_write);
$$;

revoke all on function public.workflow_quota_status(uuid, uuid), public.workflow_member_spaces(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.workflow_quota_status(uuid, uuid), public.workflow_member_spaces(uuid, uuid, boolean) to service_role;
revoke all on function private.can_see_workflow(uuid, uuid), private.can_edit_workflow(uuid, uuid) from public, anon;
grant execute on function private.can_see_workflow(uuid, uuid), private.can_edit_workflow(uuid, uuid) to authenticated, service_role;

-- Workflow AI steps count as their own feature in usage; entries a workflow adds say so.
alter table public.usage_events drop constraint usage_events_feature_check;
alter table public.usage_events add constraint usage_events_feature_check
  check (feature in ('chat', 'memory', 'confronter', 'agent', 'embedding', 'handover', 'router', 'render', 'avatar', 'client_summary', 'dictation', 'title', 'image', 'workflow'));
alter table public.memory_entries drop constraint memory_entries_source_type_check;
alter table public.memory_entries add constraint memory_entries_source_type_check
  check (source_type in ('manual', 'chat', 'ai_suggestion', 'promotion', 'auto', 'correction', 'import', 'workflow'));
