-- Step 6: Confronter (CLAUDE.md §4.5), and the framework shared by tools and agents (§4.6, §4.7).

-- ─── Confronter ──────────────────────────────────────────────────────────────
-- A confrontation is stored as an AI answer whose `content` is the recommended answer (so it is
-- copied, searched and used as context like any answer) and whose `confrontation` holds the models'
-- answers, their cross-critiques and the synthesis. Written by the server only, like every answer.
alter table public.messages add column confrontation jsonb;

-- ─── Tools and agents (one framework) ────────────────────────────────────────
-- A tool or an agent: instructions, an input form, allowed models, capabilities, memory scope and an
-- output format. Built-in agents (company_id null, Step 7) are offered to every company, which can
-- adapt them; tools are made by employees ("Turn into a tool") and shared with themselves, their team
-- or, after an Admin's approval, the whole company.
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  builtin_key text unique,
  kind text not null check (kind in ('agent', 'tool')),
  department text not null default 'general'
    check (department in ('marketing', 'sales', 'accounting', 'finance', 'hr', 'legal', 'customer_service', 'management', 'general')),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 400),
  instructions text not null check (length(trim(instructions)) between 1 and 8000),
  -- [{"key": "client", "label": "Client", "type": "text|textarea|client|select", "required": true, "options": [...]}]
  input_fields jsonb not null default '[]' check (jsonb_typeof(input_fields) = 'array' and jsonb_array_length(input_fields) <= 12),
  -- Empty: any model the company allows. `default_model`: a model id or 'auto'; null = the company default.
  allowed_models text[] not null default '{}',
  default_model text,
  -- Capabilities. At launch: 'attachments' (files can be added to a run).
  tools text[] not null default '{}' check (tools <@ array['attachments']::text[]),
  memory_scope text not null default 'company_and_client' check (memory_scope in ('none', 'company', 'company_and_client')),
  output_format text not null default 'text' check (output_format in ('text', 'table', 'email', 'document')),
  visibility text not null default 'private' check (visibility in ('private', 'team', 'company')),
  team_id uuid references public.teams (id) on delete set null,
  -- Company-wide publication: requested ('pending'), then approved or rejected by an Admin.
  publication text not null default 'none' check (publication in ('none', 'pending', 'approved', 'rejected')),
  enabled_roles public.company_role[] not null default '{owner,admin,member}',
  created_by uuid references public.profiles (id) on delete set null,
  source_conversation_id uuid references public.conversations (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((company_id is null) = (builtin_key is not null)),
  check (company_id is not null or kind = 'agent'),
  check (visibility <> 'team' or team_id is not null),
  check ((visibility = 'company') = (publication <> 'none') or company_id is null)
);
create index agents_company on public.agents (company_id, department);
create trigger agents_updated_at before update on public.agents
  for each row execute function private.touch_updated_at();

-- How a company adapts a built-in agent: on/off, roles, extra instructions, tone, model, memory.
create table public.company_agent_settings (
  company_id uuid not null references public.companies (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  enabled boolean not null default true,
  enabled_roles public.company_role[] not null default '{owner,admin,member}',
  instructions_addition text not null default '' check (length(instructions_addition) <= 4000),
  tone text not null default '' check (length(tone) <= 200),
  default_model text,
  memory_scope text check (memory_scope in ('none', 'company', 'company_and_client')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, agent_id)
);

-- Who sees an agent or tool. Built-ins: everyone. Company tools: their creator; their team for 'team';
-- everyone once approved for 'company'; Admins with the "agents" scope for those shared beyond the
-- creator (to approve them and choose roles). Private tools stay private, Admins included.
create function private.can_see_agent(p_agent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.agents a
    where a.id = p_agent
      and (
        a.company_id is null
        or (private.is_company_member(a.company_id) and (
          a.created_by = (select auth.uid())
          or (a.visibility = 'team' and a.team_id = (
            select m.team_id from public.company_members m where m.company_id = a.company_id and m.user_id = (select auth.uid())))
          or (a.visibility = 'company' and a.publication = 'approved')
          or (a.visibility <> 'private' and private.has_admin_scope(a.company_id, 'agents'))
        ))
      )
  );
$$;

-- Who may run it in a given company: they can see it, it is approved if shared company-wide (its
-- creator may still try it), it is enabled and their role is enabled.
create function private.can_use_agent(p_agent uuid, p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_see_agent(p_agent) and private.is_company_member(p_company) and exists (
    select 1 from public.agents a
    left join public.company_agent_settings s on s.agent_id = a.id and s.company_id = p_company
    where a.id = p_agent
      and (a.company_id = p_company or a.company_id is null)
      and (a.company_id is null or a.visibility <> 'company' or a.publication = 'approved' or a.created_by = (select auth.uid()))
      and coalesce(s.enabled, true)
      and private.member_role(p_company) = any (case when a.company_id is null then coalesce(s.enabled_roles, a.enabled_roles) else a.enabled_roles end)
  );
$$;

alter table public.agents enable row level security;
alter table public.company_agent_settings enable row level security;
revoke all on public.agents, public.company_agent_settings from anon;
revoke insert, update, delete, truncate, trigger, references on public.agents, public.company_agent_settings from authenticated;
create policy agents_select on public.agents for select to authenticated using (private.can_see_agent(id));
-- Creating, editing, approving and deleting go through the functions below.
create policy agent_settings_select on public.company_agent_settings
  for select to authenticated using (private.is_company_member(company_id));

-- Conversations started from a tool or an agent.
alter table public.conversations add column agent_id uuid references public.agents (id) on delete set null;
grant insert (agent_id) on public.conversations to authenticated;
create function private.conversation_agent_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.agent_id is not null and not private.can_use_agent(new.agent_id, new.company_id) then
    perform private.fail('forbidden');
  end if;
  return new;
end;
$$;
create trigger conversations_agent_guard before insert on public.conversations
  for each row execute function private.conversation_agent_guard();

-- Saves a tool (new or edited by its creator). Sharing with the whole company asks for approval,
-- unless the creator may approve (Owner, "agents" Admin). Editing an approved tool asks again.
create function public.save_tool(p_company uuid, p_id uuid, p_tool jsonb, p_visibility text, p_source_conversation uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_team uuid;
  v_can_approve boolean := private.has_admin_scope(p_company, 'agents');
  v_publication text;
  v_existing public.agents;
begin
  if not private.is_company_member(p_company) then perform private.fail('forbidden'); end if;
  if p_visibility not in ('private', 'team', 'company') then perform private.fail('validation'); end if;
  if p_visibility = 'team' then
    select team_id into v_team from public.company_members where company_id = p_company and user_id = (select auth.uid());
    if v_team is null then perform private.fail('no_team'); end if;
  end if;
  v_publication := case when p_visibility <> 'company' then 'none' when v_can_approve then 'approved' else 'pending' end;

  if p_id is null then
    insert into public.agents (company_id, kind, department, name, description, instructions, input_fields, allowed_models,
      default_model, tools, memory_scope, output_format, visibility, team_id, publication, created_by, source_conversation_id,
      decided_by, decided_at)
    values (p_company, 'tool', coalesce(p_tool->>'department', 'general'), p_tool->>'name', coalesce(p_tool->>'description', ''),
      p_tool->>'instructions', coalesce(p_tool->'input_fields', '[]'),
      coalesce(array(select jsonb_array_elements_text(p_tool->'allowed_models')), '{}'), nullif(p_tool->>'default_model', ''),
      coalesce(array(select jsonb_array_elements_text(p_tool->'tools')), '{}'), coalesce(p_tool->>'memory_scope', 'company_and_client'),
      coalesce(p_tool->>'output_format', 'text'), p_visibility, v_team, v_publication, (select auth.uid()),
      case when p_source_conversation is not null and private.can_access_conversation(p_source_conversation) then p_source_conversation end,
      case when v_publication = 'approved' then (select auth.uid()) end, case when v_publication = 'approved' then now() end)
    returning id into v_id;
    perform private.log_event('company', p_company, 'agent.created', 'agent', v_id::text,
      jsonb_build_object('kind', 'tool', 'visibility', p_visibility, 'publication', v_publication));
  else
    select * into v_existing from public.agents where id = p_id and company_id = p_company;
    if v_existing.id is null or v_existing.created_by is distinct from (select auth.uid()) then perform private.fail('not_found'); end if;
    update public.agents set
      department = coalesce(p_tool->>'department', 'general'), name = p_tool->>'name', description = coalesce(p_tool->>'description', ''),
      instructions = p_tool->>'instructions', input_fields = coalesce(p_tool->'input_fields', '[]'),
      allowed_models = coalesce(array(select jsonb_array_elements_text(p_tool->'allowed_models')), '{}'),
      default_model = nullif(p_tool->>'default_model', ''), tools = coalesce(array(select jsonb_array_elements_text(p_tool->'tools')), '{}'),
      memory_scope = coalesce(p_tool->>'memory_scope', 'company_and_client'), output_format = coalesce(p_tool->>'output_format', 'text'),
      visibility = p_visibility, team_id = v_team, publication = v_publication,
      decided_by = case when v_publication = 'approved' then (select auth.uid()) end,
      decided_at = case when v_publication = 'approved' then now() end
    where id = p_id;
    v_id := p_id;
    perform private.log_event('company', p_company, 'agent.updated', 'agent', v_id::text,
      jsonb_build_object('visibility', p_visibility, 'publication', v_publication));
  end if;
  return v_id;
end;
$$;

-- An Admin with the "agents" scope approves or rejects a company-wide tool.
create function public.decide_tool(p_agent uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.agents where id = p_agent and visibility = 'company' and publication = 'pending';
  if v_company is null then perform private.fail('not_found'); end if;
  if not private.has_admin_scope(v_company, 'agents') then perform private.fail('forbidden'); end if;
  update public.agents set publication = case when p_approve then 'approved' else 'rejected' end,
    decided_by = (select auth.uid()), decided_at = now()
  where id = p_agent;
  perform private.log_event('company', v_company, case when p_approve then 'agent.approved' else 'agent.rejected' end, 'agent', p_agent::text, '{}');
end;
$$;

-- Roles that may use a shared company tool ("agents" scope).
create function public.set_tool_roles(p_agent uuid, p_roles public.company_role[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.agents where id = p_agent and company_id is not null and visibility <> 'private';
  if v_company is null then perform private.fail('not_found'); end if;
  if not private.has_admin_scope(v_company, 'agents') then perform private.fail('forbidden'); end if;
  update public.agents set enabled_roles = coalesce(p_roles, '{}') where id = p_agent;
  perform private.log_event('company', v_company, 'agent.roles_updated', 'agent', p_agent::text, jsonb_build_object('roles', p_roles));
end;
$$;

-- Deletes a tool: its creator, or an "agents" Admin for a tool shared beyond its creator.
create function public.delete_tool(p_agent uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tool public.agents;
begin
  select * into v_tool from public.agents where id = p_agent and company_id is not null;
  if v_tool.id is null or not private.can_see_agent(p_agent) then perform private.fail('not_found'); end if;
  if v_tool.created_by is distinct from (select auth.uid()) and not (v_tool.visibility <> 'private' and private.has_admin_scope(v_tool.company_id, 'agents')) then
    perform private.fail('forbidden');
  end if;
  delete from public.agents where id = p_agent;
  perform private.log_event('company', v_tool.company_id, 'agent.deleted', 'agent', p_agent::text, jsonb_build_object('kind', v_tool.kind));
end;
$$;

-- A company adapts a built-in agent ("agents" scope).
create function public.admin_set_agent_settings(p_company uuid, p_agent uuid, p_settings jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_admin_scope(p_company, 'agents') then perform private.fail('forbidden'); end if;
  if not exists (select 1 from public.agents where id = p_agent and company_id is null) then perform private.fail('not_found'); end if;
  insert into public.company_agent_settings (company_id, agent_id, enabled, enabled_roles, instructions_addition, tone, default_model, memory_scope, updated_by)
  values (p_company, p_agent, coalesce((p_settings->>'enabled')::boolean, true),
    coalesce(array(select jsonb_array_elements_text(p_settings->'enabled_roles'))::public.company_role[], '{owner,admin,member}'),
    coalesce(p_settings->>'instructions_addition', ''), coalesce(p_settings->>'tone', ''), nullif(p_settings->>'default_model', ''),
    nullif(p_settings->>'memory_scope', ''), (select auth.uid()))
  on conflict (company_id, agent_id) do update set
    enabled = excluded.enabled, enabled_roles = excluded.enabled_roles, instructions_addition = excluded.instructions_addition,
    tone = excluded.tone, default_model = excluded.default_model, memory_scope = excluded.memory_scope,
    updated_by = excluded.updated_by, updated_at = now();
  perform private.log_event('company', p_company, 'agent.settings_updated', 'agent', p_agent::text, '{}');
end;
$$;

-- Teams: an Admin with the "members" scope puts an employee in a team (or none).
create function public.admin_set_member_team(p_company uuid, p_user uuid, p_team_name text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_team uuid;
  v_name text := nullif(trim(coalesce(p_team_name, '')), '');
begin
  if not private.has_admin_scope(p_company, 'members') then perform private.fail('forbidden'); end if;
  if not exists (select 1 from public.company_members where company_id = p_company and user_id = p_user) then perform private.fail('not_found'); end if;
  if v_name is not null then
    if length(v_name) > 80 then perform private.fail('validation'); end if;
    insert into public.teams (company_id, name) values (p_company, v_name) on conflict (company_id, name) do nothing;
    select id into v_team from public.teams where company_id = p_company and name = v_name;
  end if;
  update public.company_members set team_id = v_team where company_id = p_company and user_id = p_user;
  perform private.log_event('company', p_company, 'member.team_changed', 'member', p_user::text, '{}');
end;
$$;

revoke execute on function public.save_tool(uuid, uuid, jsonb, text, uuid) from public, anon;
revoke execute on function public.decide_tool(uuid, boolean) from public, anon;
revoke execute on function public.set_tool_roles(uuid, public.company_role[]) from public, anon;
revoke execute on function public.delete_tool(uuid) from public, anon;
revoke execute on function public.admin_set_agent_settings(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.admin_set_member_team(uuid, uuid, text) from public, anon;
grant execute on function public.save_tool(uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.decide_tool(uuid, boolean) to authenticated;
grant execute on function public.set_tool_roles(uuid, public.company_role[]) to authenticated;
grant execute on function public.delete_tool(uuid) to authenticated;
grant execute on function public.admin_set_agent_settings(uuid, uuid, jsonb) to authenticated;
grant execute on function public.admin_set_member_team(uuid, uuid, text) to authenticated;
