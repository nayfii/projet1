-- Our console (CLAUDE.md §11, founder's request of 2026-11-02): numbered versions launched from the
-- console, a check of each live version seen as a demo boss and a demo employee, and changes prepared
-- by Claude Code. None of it touches customer content.

-- ─── Demo company used by the version check ──────────────────────────────────
-- Fictional, ours, clearly marked. The check signs in as its demo boss and demo employee only.
alter table public.companies add column is_demo boolean not null default false;

create function public.platform_seed_demo_company(p_owner uuid, p_member uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_client uuid;
begin
  if p_owner is null or p_member is null or p_owner = p_member then perform private.fail('validation'); end if;
  -- Only accounts that belong to no other company: the demo can never reach a customer's space.
  if exists (
    select 1 from public.company_members m join public.companies c on c.id = m.company_id
    where m.user_id in (p_owner, p_member) and not c.is_demo
  ) then
    perform private.fail('forbidden');
  end if;

  select c.id into v_company from public.companies c
  join public.company_members m on m.company_id = c.id and m.user_id = p_owner and m.role = 'owner'
  where c.is_demo limit 1;

  if v_company is null then
    insert into public.companies (name, plan_id, industry, description, default_locale, created_by, is_demo, onboarding_completed_at)
    values ('Démo — vérification', (select id from public.plans where is_default and is_active limit 1), 'Démonstration',
      'Entreprise fictive utilisée par la vérification automatique de chaque version. Aucune donnée réelle.', 'fr', p_owner, true, now())
    returning id into v_company;
    insert into public.company_members (company_id, user_id, role, job_title) values (v_company, p_owner, 'owner', 'Gérant (démo)');
  end if;

  insert into public.company_members (company_id, user_id, role, job_title, expertise)
  values (v_company, p_member, 'member', 'Employée (démo)', '{finance}')
  on conflict (company_id, user_id) do update set status = 'active', role = 'member';
  update public.profiles set full_name = 'Gérant démo', active_company_id = v_company where id = p_owner and full_name is distinct from 'Gérant démo';
  update public.profiles set full_name = 'Employée démo', active_company_id = v_company where id = p_member and full_name is distinct from 'Employée démo';
  update public.profiles set active_company_id = v_company where id in (p_owner, p_member) and active_company_id is distinct from v_company;

  if not exists (select 1 from public.clients where company_id = v_company) then
    insert into public.clients (company_id, name, visibility, sector, description, created_by)
    values (v_company, 'Client démo (fictif)', 'open', 'Commerce', 'Client fictif pour la vérification automatique.', p_owner)
    returning id into v_client;
  end if;
  return v_company;
end;
$$;
revoke execute on function public.platform_seed_demo_company(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_seed_demo_company(uuid, uuid) to service_role;

-- ─── Results of each version check ───────────────────────────────────────────
create table public.platform_check_runs (
  id uuid primary key default gen_random_uuid(),
  github_run_id bigint,
  version text check (length(version) <= 40),
  commit_sha text check (length(commit_sha) <= 64),
  status text not null check (status in ('passed', 'failed')),
  -- [{role, screen, path, ok, error, image}]: screen names and outcomes, images of the demo company only.
  results jsonb not null default '[]',
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);
create index platform_check_runs_recent on public.platform_check_runs (finished_at desc);
alter table public.platform_check_runs enable row level security;
revoke all on public.platform_check_runs from anon, authenticated;
grant select on public.platform_check_runs to authenticated;
create policy platform_check_runs_select on public.platform_check_runs
  for select to authenticated using ((select private.is_platform_admin()));
-- Written by the check workflow with the service key only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('platform-checks', 'platform-checks', false, 2 * 1024 * 1024, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy platform_checks_select on storage.objects
  for select to authenticated using (bucket_id = 'platform-checks' and (select private.is_platform_admin()));

-- ─── Changes asked of Claude Code ────────────────────────────────────────────
create table public.platform_fix_requests (
  id uuid primary key default gen_random_uuid(),
  request text not null check (length(trim(request)) between 5 and 4000),
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index platform_fix_requests_recent on public.platform_fix_requests (created_at desc);
alter table public.platform_fix_requests enable row level security;
revoke all on public.platform_fix_requests from anon, authenticated;
grant select on public.platform_fix_requests to authenticated;
create policy platform_fix_requests_select on public.platform_fix_requests
  for select to authenticated using ((select private.is_platform_admin()));

create function public.platform_create_fix_request(p_request text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if length(trim(coalesce(p_request, ''))) not between 5 and 4000 then perform private.fail('validation'); end if;
  insert into public.platform_fix_requests (request, requested_by) values (trim(p_request), (select auth.uid())) returning id into v_id;
  perform private.log_event('platform', null, 'fix.requested', 'fix_request', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

-- Launches, checks and fix decisions in the platform audit log (no text, no content).
create function public.platform_log_release_event(p_action text, p_target text, p_version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_action not in ('release.launched', 'check.requested', 'fix.accepted', 'fix.rejected') then perform private.fail('validation'); end if;
  perform private.log_event('platform', null, p_action, 'release', left(coalesce(p_target, ''), 80),
    jsonb_strip_nulls(jsonb_build_object('version', case when p_version ~ '^v?[0-9]+\.[0-9]+$' then p_version end)));
end;
$$;

revoke execute on function public.platform_create_fix_request(text), public.platform_log_release_event(text, text, text) from public, anon;
grant execute on function public.platform_create_fix_request(text), public.platform_log_release_event(text, text, text) to authenticated;
