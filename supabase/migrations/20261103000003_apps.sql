-- Applications (CLAUDE.md §11, replaces the Library): favourites per person, the most used apps in a
-- company, apps our team adds for every customer, and two launch switches set by our team:
-- video apps (until the render worker is hosted) and the Application Review Assistant (until a lawyer
-- has reviewed it). Both are off by default.

alter table public.platform_settings
  add column video_apps_enabled boolean not null default false,
  add column app_review_enabled boolean not null default false;

-- What every signed-in person may know: which launch apps are open (two booleans, nothing else).
create function public.app_availability() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('video', coalesce(s.video_apps_enabled, false), 'app_review', coalesce(s.app_review_enabled, false))
  from public.platform_settings s limit 1;
$$;

create function public.platform_set_app_switches(p_video boolean default null, p_app_review boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  update public.platform_settings
    set video_apps_enabled = coalesce(p_video, video_apps_enabled),
        app_review_enabled = coalesce(p_app_review, app_review_enabled),
        updated_by = (select auth.uid()), updated_at = now()
    where id;
  perform private.log_event('platform', null, 'settings.apps', 'platform_settings', 'apps',
    jsonb_strip_nulls(jsonb_build_object('video', p_video, 'app_review', p_app_review)));
end;
$$;

-- ─── Favourites ──────────────────────────────────────────────────────────────
create table public.app_favorites (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id, agent_id)
);
alter table public.app_favorites enable row level security;
revoke all on public.app_favorites from anon, authenticated;
grant select, insert, delete on public.app_favorites to authenticated;
create policy app_favorites_own on public.app_favorites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_company_member(company_id) and private.can_see_agent(agent_id));

-- ─── Most used in the company (counts only) ──────────────────────────────────
create function public.company_popular_apps(p_company uuid) returns table (agent_id uuid, uses bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_company_member(p_company) then perform private.fail('forbidden'); end if;
  return query
  select c.agent_id, count(*) from public.conversations c
  where c.company_id = p_company and c.agent_id is not null and c.created_at >= now() - interval '30 days'
  group by c.agent_id order by count(*) desc limit 12;
end;
$$;

-- ─── Apps our team adds for every customer ───────────────────────────────────
-- Stored like built-in agents (company_id null) with a "platform_" key, so the code's built-in sync
-- never touches them. Written only through these functions.
create function public.platform_save_app(
  p_id uuid, p_name text, p_department text, p_description text, p_instructions text,
  p_fields jsonb, p_output_format text, p_memory_scope text, p_tools text[], p_enabled boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_id is null then
    insert into public.agents (builtin_key, kind, department, name, description, instructions, input_fields, output_format,
                               memory_scope, tools, visibility, publication, enabled_roles, created_by)
    values ('platform_' || replace(gen_random_uuid()::text, '-', ''), 'agent', p_department, trim(p_name), coalesce(trim(p_description), ''),
            trim(p_instructions), coalesce(p_fields, '[]'), p_output_format, p_memory_scope, coalesce(p_tools, '{}'), 'private', 'none',
            case when coalesce(p_enabled, true) then '{owner,admin,manager,member}'::public.company_role[] else '{}'::public.company_role[] end,
            (select auth.uid()))
    returning id into v_id;
  else
    update public.agents set
      department = p_department, name = trim(p_name), description = coalesce(trim(p_description), ''),
      instructions = trim(p_instructions), input_fields = coalesce(p_fields, '[]'), output_format = p_output_format,
      memory_scope = p_memory_scope, tools = coalesce(p_tools, '{}'),
      enabled_roles = case when coalesce(p_enabled, true) then '{owner,admin,manager,member}'::public.company_role[] else '{}'::public.company_role[] end
    where id = p_id and company_id is null and builtin_key like 'platform\_%'
    returning id into v_id;
    if v_id is null then perform private.fail('not_found'); end if;
  end if;
  perform private.log_event('platform', null, 'app.saved', 'agent', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

create function public.platform_delete_app(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  delete from public.agents where id = p_id and company_id is null and builtin_key like 'platform\_%';
  if not found then perform private.fail('not_found'); end if;
  perform private.log_event('platform', null, 'app.deleted', 'agent', p_id::text, '{}'::jsonb);
end;
$$;

revoke execute on function public.app_availability(), public.platform_set_app_switches(boolean, boolean),
  public.company_popular_apps(uuid), public.platform_save_app(uuid, text, text, text, text, jsonb, text, text, text[], boolean),
  public.platform_delete_app(uuid) from public, anon;
grant execute on function public.app_availability(), public.platform_set_app_switches(boolean, boolean),
  public.company_popular_apps(uuid), public.platform_save_app(uuid, text, text, text, text, jsonb, text, text, text[], boolean),
  public.platform_delete_app(uuid) to authenticated;
