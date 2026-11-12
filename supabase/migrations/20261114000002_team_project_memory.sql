-- Consciousness, V1.1 (CLAUDE.md §12): the five levels of memory are personal (personal_notes), team,
-- client, project and company. This adds the team and project levels.
-- - Team memory: one per team, read and written by the team's members (and the Owner). No permission
--   categories: belonging to the team is the rule.
-- - Projects: a piece of work in a company, optionally for a client. A project is visible to every
--   member, or, for a client's project, to those who may open that client. Its memory follows the same
--   rule plus the usual permission categories (everyone reads and writes by default, like a client).

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade
);
create index projects_company on public.projects (company_id) where archived_at is null;
create index projects_client on public.projects (client_id) where client_id is not null;
alter table public.projects enable row level security;

create function private.user_has_project_access(p_project uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.projects p
    join public.companies c on c.id = p.company_id and c.status = 'active'
    join public.company_members m on m.company_id = p.company_id and m.user_id = p_user and m.status = 'active'
    where p.id = p_project
      and (p.client_id is null or private.user_has_client_access(p.client_id, p_user))
  );
$$;

revoke all on public.projects from anon;
revoke insert, update, delete, truncate, trigger, references on public.projects from authenticated;
grant insert (company_id, client_id, name, description) on public.projects to authenticated;
grant update (name, description, archived_at) on public.projects to authenticated;

-- Written on the row's own columns (not by re-reading the table), so a new project is visible to its
-- creator in the same statement (insert … returning).
create policy projects_select on public.projects
  for select to authenticated using (
    private.is_company_member(company_id)
    and (client_id is null or private.user_has_client_access(client_id, (select auth.uid())))
  );
-- Any active member starts a project, alone or for a client they can open.
create policy projects_insert on public.projects
  for insert to authenticated with check (
    private.is_company_member(company_id)
    and created_by = (select auth.uid())
    and (client_id is null or private.user_has_client_access(client_id, (select auth.uid())))
  );
-- Its creator, the Owner or a client Admin renames, describes or archives it.
create policy projects_update on public.projects
  for update to authenticated
  using (
    private.is_company_member(company_id)
    and (client_id is null or private.user_has_client_access(client_id, (select auth.uid())))
    and (created_by = (select auth.uid()) or private.has_admin_scope(company_id, 'clients'))
  )
  with check (
    private.is_company_member(company_id)
    and (client_id is null or private.user_has_client_access(client_id, (select auth.uid())))
    and (created_by = (select auth.uid()) or private.has_admin_scope(company_id, 'clients'))
  );

-- ─── Memory spaces for teams and projects ─────────────────────────────────────
alter table public.memory_spaces
  add column team_id uuid,
  add column project_id uuid,
  add foreign key (team_id, company_id) references public.teams (id, company_id) on delete cascade,
  add foreign key (project_id, company_id) references public.projects (id, company_id) on delete cascade;
alter table public.memory_spaces drop constraint memory_spaces_check;
alter table public.memory_spaces add constraint memory_spaces_scope check (
  (kind = 'company' and client_id is null and team_id is null and project_id is null)
  or (kind = 'client' and client_id is not null and team_id is null and project_id is null)
  or (kind = 'team' and team_id is not null and client_id is null and project_id is null)
  or (kind = 'project' and project_id is not null and client_id is null and team_id is null)
);
create unique index memory_spaces_one_per_team on public.memory_spaces (team_id) where team_id is not null;
create unique index memory_spaces_one_per_project on public.memory_spaces (project_id) where project_id is not null;

-- The one rule every memory read and write goes through (RLS, retrieval, group intersection).
create or replace function private.user_space_right(p_space uuid, p_user uuid, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memory_spaces s
    join public.companies c on c.id = s.company_id and c.status = 'active'
    join public.company_members m on m.company_id = s.company_id and m.user_id = p_user and m.status = 'active'
    where s.id = p_space
      and (
        m.role = 'owner'
        or (s.kind = 'team' and m.team_id is not null and m.team_id = s.team_id)
        or (
          (s.kind = 'company'
            or (s.kind = 'client' and private.user_has_client_access(s.client_id, p_user))
            or (s.kind = 'project' and private.user_has_project_access(s.project_id, p_user)))
          and exists (
            select 1 from public.memory_space_grants g
            where g.space_id = s.id
              and (case when p_write then g.can_write else g.can_read end)
              and private.user_in_category(g.category_id, p_user)
          )
        )
      )
  );
$$;

create function private.init_team_memory(p_team uuid, p_company uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.memory_spaces (company_id, kind, team_id) values (p_company, 'team', p_team) on conflict do nothing;
$$;

create function private.init_project_memory(p_project uuid, p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_space uuid;
  v_everyone uuid;
begin
  insert into public.memory_spaces (company_id, kind, project_id) values (p_company, 'project', p_project) on conflict do nothing;
  select id into v_space from public.memory_spaces where project_id = p_project;
  select id into v_everyone from public.permission_categories where company_id = p_company and system_key = 'everyone';
  insert into public.memory_space_grants (space_id, company_id, category_id, can_read, can_write)
  values (v_space, p_company, v_everyone, true, true)
  on conflict do nothing;
end;
$$;

create function private.on_team_created_memory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.init_team_memory(new.id, new.company_id);
  return new;
end;
$$;
create trigger teams_init_memory after insert on public.teams
  for each row execute function private.on_team_created_memory();

create function private.on_project_created_memory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.init_project_memory(new.id, new.company_id);
  return new;
end;
$$;
create trigger projects_init_memory after insert on public.projects
  for each row execute function private.on_project_created_memory();

select private.init_team_memory(id, company_id) from public.teams;

-- The memories a person can read, with what each belongs to (the app names them).
drop function public.my_memory_spaces(uuid);
create function public.my_memory_spaces(p_company uuid)
returns table (space_id uuid, kind public.memory_kind, client_id uuid, team_id uuid, project_id uuid, project_client_id uuid,
               can_write boolean, entry_count bigint, document_count bigint, blocked_providers public.ai_provider[])
language sql stable security definer set search_path = '' as $$
  select s.id, s.kind, s.client_id, s.team_id, s.project_id, p.client_id, private.can_write_space(s.id),
    (select count(*) from public.memory_entries e where e.space_id = s.id and e.status = 'active'),
    (select count(*) from public.documents d where d.space_id = s.id),
    s.blocked_providers
  from public.memory_spaces s
  left join public.projects p on p.id = s.project_id
  where s.company_id = p_company and private.can_read_space(s.id) and p.archived_at is null;
$$;

revoke all on function private.user_has_project_access(uuid, uuid), private.init_team_memory(uuid, uuid),
  private.init_project_memory(uuid, uuid) from public, anon;
grant execute on function private.user_has_project_access(uuid, uuid) to authenticated, service_role;
revoke execute on function public.my_memory_spaces(uuid) from public, anon;
grant execute on function public.my_memory_spaces(uuid) to authenticated;
grant select on public.projects to authenticated;
