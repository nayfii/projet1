-- Step 12: clients, permissions and collaboration (CLAUDE.md §11).
--
-- * Managers manage access to clients for the members of their team, never conversation content.
-- * Everyone creates open clients; restricted ones by the Owner, client Admins and Managers.
-- * A client is deleted for good only once archived, by the Owner, retyping its name.
-- * Conversation participants: read only, participate, manage participants (and the owner).
-- * A transfer forks the conversation: the sender keeps a private copy up to the transfer.
-- * Personal memory: notes the AI uses for one person only. Client memory can be fed automatically.

-- ─── Managers ────────────────────────────────────────────────────────────────
alter table public.company_members add constraint company_members_manager_team check (role <> 'manager' or team_id is not null);

create function private.is_manager(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m join public.companies c on c.id = m.company_id
    where m.company_id = p_company and m.user_id = (select auth.uid()) and m.role = 'manager'
      and m.status = 'active' and c.status = 'active'
  );
$$;

-- The caller is the manager of p_user's team (an active colleague, never the Owner).
create function private.manages_member(p_company uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.company_members me
    join public.company_members them on them.company_id = me.company_id and them.team_id = me.team_id
    join public.companies c on c.id = me.company_id
    where me.company_id = p_company and me.user_id = (select auth.uid()) and me.role = 'manager' and me.status = 'active'
      and c.status = 'active' and them.user_id = p_user and them.status = 'active' and them.role <> 'owner'
  );
$$;

-- A manager gives their team access to the restricted clients they can open themselves.
drop policy client_assignments_insert on public.client_assignments;
create policy client_assignments_insert on public.client_assignments
  for insert to authenticated
  with check (
    assigned_by = (select auth.uid())
    and (private.has_admin_scope(company_id, 'clients')
      or (private.manages_member(company_id, user_id) and private.has_client_access(client_id)))
  );
drop policy client_assignments_delete on public.client_assignments;
create policy client_assignments_delete on public.client_assignments
  for delete to authenticated
  using (
    private.has_admin_scope(company_id, 'clients')
    or (private.manages_member(company_id, user_id) and private.has_client_access(client_id))
  );

-- ─── Clients ─────────────────────────────────────────────────────────────────
drop policy clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_company_member(company_id)
    and archived_at is null
    and (visibility = 'open' or private.has_admin_scope(company_id, 'clients') or private.is_manager(company_id))
  );
drop policy clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using (private.has_admin_scope(company_id, 'clients') or (private.is_manager(company_id) and private.has_client_access(id)))
  with check (private.has_admin_scope(company_id, 'clients') or (private.is_manager(company_id) and private.has_client_access(id)));
-- Deleting for good goes through delete_client (archived first, name retyped).
drop policy clients_delete on public.clients;

-- Whoever creates a restricted client without managing all clients keeps access to it.
create function private.clients_assign_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'restricted' and new.created_by is not null
     and not private.has_admin_scope(new.company_id, 'clients') then
    insert into public.client_assignments (client_id, company_id, user_id, assigned_by)
    values (new.id, new.company_id, new.created_by, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger clients_assign_creator after insert on public.clients
  for each row execute function private.clients_assign_creator();

create function public.delete_client(p_client uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client public.clients;
begin
  select * into v_client from public.clients where id = p_client;
  if v_client.id is null or not private.is_company_owner(v_client.company_id) then perform private.fail('not_found'); end if;
  if v_client.archived_at is null then perform private.fail('archive_first'); end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(v_client.name)) then perform private.fail('name_mismatch'); end if;
  delete from public.clients where id = p_client;
end;
$$;

-- ─── Conversation participants: read only, participate, manage ──────────────
alter table public.conversation_participants drop constraint conversation_participants_role_check;
alter table public.conversation_participants add constraint conversation_participants_role_check
  check (role in ('owner', 'manager', 'participant', 'reader'));

create function private.can_post_in_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_access_conversation(p_conversation) and exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = p_conversation and p.user_id = (select auth.uid()) and p.role <> 'reader'
  );
$$;

create function private.can_manage_participants(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_access_conversation(p_conversation) and exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = p_conversation and p.user_id = (select auth.uid()) and p.role in ('owner', 'manager')
  );
$$;

-- Readers read; they neither write nor attach files.
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (author_type = 'user' and author_id = (select auth.uid()) and private.can_post_in_conversation(conversation_id));
drop policy attachments_insert on public.conversation_attachments;
create policy attachments_insert on public.conversation_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.can_post_in_conversation(conversation_id)
    and storage_path like conversation_id::text || '/%'
  );

-- Adding people now takes a right (default: participate) and needs the right to manage participants.
drop function public.add_conversation_participants(uuid, uuid[], integer);
create function public.add_conversation_participants(
  p_conversation uuid, p_users uuid[], p_from_seq integer default null, p_role text default 'participant'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_client uuid;
  v_mine integer;
  v_next integer;
  v_from integer;
  v_user uuid;
begin
  if not private.can_manage_participants(p_conversation) then perform private.fail('not_found'); end if;
  if p_role not in ('manager', 'participant', 'reader') then perform private.fail('validation'); end if;
  select company_id, client_id into v_company, v_client from public.conversations where id = p_conversation;
  select visible_from_seq into v_mine from public.conversation_participants
  where conversation_id = p_conversation and user_id = (select auth.uid());
  select coalesce(max(seq), 0) + 1 into v_next from public.messages where conversation_id = p_conversation;
  v_from := coalesce(p_from_seq, v_next);
  if v_from < v_mine or v_from > v_next then perform private.fail('validation'); end if;
  if cardinality(coalesce(p_users, '{}')) = 0 or cardinality(p_users) > 20 then perform private.fail('validation'); end if;

  foreach v_user in array p_users loop
    if not exists (
      select 1 from public.company_members m where m.company_id = v_company and m.user_id = v_user and m.status = 'active'
    ) then
      perform private.fail('not_found');
    end if;
    if v_client is not null and not private.user_has_client_access(v_client, v_user) then
      perform private.fail('no_client_access');
    end if;
    insert into public.conversation_participants (conversation_id, company_id, user_id, role, visible_from_seq, added_by)
    values (p_conversation, v_company, v_user, p_role, v_from, (select auth.uid()))
    on conflict (conversation_id, user_id) do nothing;
    if found then
      perform private.log_event('company', v_company, 'conversation.participant_added', 'conversation', p_conversation::text,
        jsonb_build_object('user_id', v_user, 'history_shared', v_from < v_next, 'role', p_role));
    end if;
  end loop;
end;
$$;

-- Sharing more history also needs the right to manage participants.
create or replace function public.share_conversation_history(p_conversation uuid, p_user uuid, p_from_seq integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_mine integer;
  v_theirs integer;
  v_company uuid;
begin
  if not private.can_manage_participants(p_conversation) then perform private.fail('not_found'); end if;
  select visible_from_seq into v_mine from public.conversation_participants
  where conversation_id = p_conversation and user_id = (select auth.uid());
  select visible_from_seq, company_id into v_theirs, v_company from public.conversation_participants
  where conversation_id = p_conversation and user_id = p_user;
  if v_theirs is null then perform private.fail('not_found'); end if;
  if p_from_seq < v_mine or p_from_seq >= v_theirs then perform private.fail('validation'); end if;
  update public.conversation_participants set visible_from_seq = p_from_seq
  where conversation_id = p_conversation and user_id = p_user;
  perform private.log_event('company', v_company, 'conversation.history_shared', 'conversation', p_conversation::text,
    jsonb_build_object('user_id', p_user));
end;
$$;

create function public.set_participant_role(p_conversation uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  if not private.can_manage_participants(p_conversation) then perform private.fail('not_found'); end if;
  if p_role not in ('manager', 'participant', 'reader') then perform private.fail('validation'); end if;
  update public.conversation_participants set role = p_role
  where conversation_id = p_conversation and user_id = p_user and role <> 'owner'
  returning company_id into v_company;
  if v_company is null then perform private.fail('not_found'); end if;
  perform private.log_event('company', v_company, 'conversation.participant_role', 'conversation', p_conversation::text,
    jsonb_build_object('user_id', p_user, 'role', p_role));
end;
$$;

create function public.remove_conversation_participant(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  if not private.can_manage_participants(p_conversation) then perform private.fail('not_found'); end if;
  if p_user = (select auth.uid()) then perform private.fail('validation'); end if;
  delete from public.conversation_participants
  where conversation_id = p_conversation and user_id = p_user and role <> 'owner'
  returning company_id into v_company;
  if v_company is null then perform private.fail('not_found'); end if;
  perform private.log_event('company', v_company, 'conversation.participant_removed', 'conversation', p_conversation::text,
    jsonb_build_object('user_id', p_user));
end;
$$;

-- ─── Transfer = fork ─────────────────────────────────────────────────────────
alter table public.conversations
  -- On the sender's copy: where it came from (no access implied), to whom and when it was transferred.
  add column forked_from uuid,
  add column transferred_to uuid references public.profiles (id) on delete set null,
  add column transferred_at timestamptz,
  -- On the transferred conversation: who handed it over.
  add column received_from uuid references public.profiles (id) on delete set null,
  -- "Do not feed the memory": no automatic client memory from this conversation.
  add column feed_memory boolean not null default true;
grant update (feed_memory) on public.conversations to authenticated;

-- The recipient continues the conversation; the sender keeps a private copy of everything they
-- could see up to now, as a separate branch, and never sees what comes next. Attachments and Hide
-- values are copied by the server (they need the storage API and the encryption key).
drop function public.transfer_conversation(uuid, uuid, jsonb, boolean);
create function public.transfer_conversation(p_conversation uuid, p_to uuid, p_sections jsonb, p_ai_generated boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_conv public.conversations;
  v_handover uuid;
  v_copy uuid;
  v_from integer;
  v_row public.messages;
  v_new uuid;
  v_map jsonb := '{}';
begin
  if not private.can_access_conversation(p_conversation) then perform private.fail('not_found'); end if;
  select * into v_conv from public.conversations where id = p_conversation and owner_id = (select auth.uid());
  if v_conv.id is null then perform private.fail('owner_only'); end if;
  if p_to = (select auth.uid()) or not exists (
    select 1 from public.company_members m where m.company_id = v_conv.company_id and m.user_id = p_to and m.status = 'active'
  ) then
    perform private.fail('not_found');
  end if;
  if v_conv.client_id is not null and not private.user_has_client_access(v_conv.client_id, p_to) then perform private.fail('no_client_access'); end if;
  if exists (select 1 from public.messages where conversation_id = p_conversation and status = 'streaming') then perform private.fail('busy'); end if;

  -- The sender's copy.
  insert into public.conversations (company_id, client_id, owner_id, title, model_choice, agent_id, forked_from, transferred_to, transferred_at, feed_memory)
  values (
    v_conv.company_id, v_conv.client_id, (select auth.uid()), v_conv.title, v_conv.model_choice,
    case when v_conv.agent_id is not null and private.can_use_agent(v_conv.agent_id, v_conv.company_id) then v_conv.agent_id end,
    p_conversation, p_to, now(), v_conv.feed_memory
  )
  returning id into v_copy;
  select visible_from_seq into v_from from public.conversation_participants
  where conversation_id = p_conversation and user_id = (select auth.uid());
  for v_row in
    select * from public.messages
    where conversation_id = p_conversation and seq >= coalesce(v_from, 1) and superseded_at is null
    order by seq
  loop
    v_new := gen_random_uuid();
    insert into public.messages
    select (jsonb_populate_record(null::public.messages, to_jsonb(v_row) || jsonb_build_object(
      'id', v_new, 'conversation_id', v_copy, 'stop_requested_at', null))).*;
    v_map := v_map || jsonb_build_object(v_row.id::text, v_new);
  end loop;
  insert into public.message_sources
  select (jsonb_populate_record(null::public.message_sources, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'message_id', v_map ->> s.message_id::text, 'conversation_id', v_copy))).*
  from public.message_sources s
  where s.conversation_id = p_conversation and v_map ? s.message_id::text;

  -- The transfer itself.
  update public.conversations set owner_id = p_to, received_from = (select auth.uid()) where id = p_conversation;
  insert into public.conversation_participants (conversation_id, company_id, user_id, role, visible_from_seq, added_by)
  values (p_conversation, v_conv.company_id, p_to, 'owner', 1, (select auth.uid()))
  on conflict (conversation_id, user_id) do update set role = 'owner', visible_from_seq = 1;
  delete from public.conversation_participants where conversation_id = p_conversation and user_id = (select auth.uid());

  insert into public.handovers (company_id, kind, conversation_id, from_user, to_user, sections, ai_generated)
  values (v_conv.company_id, 'conversation', p_conversation, (select auth.uid()), p_to, coalesce(p_sections, '{}'), coalesce(p_ai_generated, false))
  returning id into v_handover;
  perform private.log_event('company', v_conv.company_id, 'conversation.transferred', 'conversation', p_conversation::text,
    jsonb_build_object('user_id', p_to, 'copy_kept', true));
  return jsonb_build_object('handover', v_handover, 'copy', v_copy, 'messages', v_map);
end;
$$;

-- ─── Personal memory ─────────────────────────────────────────────────────────
-- Notes the AI uses for one person only (CLAUDE.md §11). Nobody else reads them: no Admin, no Owner,
-- no platform team; never used in group conversations.
create table public.personal_memory (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content text not null check (length(trim(content)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personal_memory_owner on public.personal_memory (company_id, user_id, created_at);
create trigger personal_memory_updated_at before update on public.personal_memory
  for each row execute function private.touch_updated_at();
alter table public.personal_memory enable row level security;
revoke all on public.personal_memory from anon;
create policy personal_memory_own on public.personal_memory
  for all to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id))
  with check (user_id = (select auth.uid()) and private.is_company_member(company_id));

create function private.personal_memory_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.personal_memory where company_id = new.company_id and user_id = new.user_id) >= 50 then
    perform private.fail('limit_reached');
  end if;
  return new;
end;
$$;
create trigger personal_memory_limit before insert on public.personal_memory
  for each row execute function private.personal_memory_limit();

-- ─── Client memory fed automatically; dictation ──────────────────────────────
alter table public.memory_entries drop constraint memory_entries_source_type_check;
alter table public.memory_entries add constraint memory_entries_source_type_check
  check (source_type in ('manual', 'chat', 'ai_suggestion', 'promotion', 'auto'));
drop policy memory_entries_insert on public.memory_entries;
create policy memory_entries_insert on public.memory_entries
  for insert to authenticated
  with check (
    private.can_write_space(space_id) and author_id = (select auth.uid()) and source_type in ('manual', 'chat', 'auto')
  );

alter table public.company_ai_settings
  add column auto_client_memory boolean not null default true,
  add column dictation_enabled boolean not null default true;

alter table public.usage_events drop constraint usage_events_feature_check;
alter table public.usage_events add constraint usage_events_feature_check
  check (feature in ('chat', 'memory', 'confronter', 'agent', 'embedding', 'handover', 'router', 'render', 'avatar', 'client_summary', 'dictation'));

-- ─── Function rights ─────────────────────────────────────────────────────────
revoke execute on function private.is_manager(uuid), private.manages_member(uuid, uuid), private.can_post_in_conversation(uuid),
  private.can_manage_participants(uuid), private.clients_assign_creator(), private.personal_memory_limit() from public, anon;
grant execute on function private.is_manager(uuid), private.manages_member(uuid, uuid), private.can_post_in_conversation(uuid),
  private.can_manage_participants(uuid) to authenticated, service_role;
revoke execute on function public.delete_client(uuid, text), public.add_conversation_participants(uuid, uuid[], integer, text),
  public.set_participant_role(uuid, uuid, text), public.remove_conversation_participant(uuid, uuid),
  public.transfer_conversation(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.delete_client(uuid, text), public.add_conversation_participants(uuid, uuid[], integer, text),
  public.set_participant_role(uuid, uuid, text), public.remove_conversation_participant(uuid, uuid),
  public.transfer_conversation(uuid, uuid, jsonb, boolean) to authenticated;

-- ─── Agents: managers use what members use ───────────────────────────────────
update public.agents set enabled_roles = array_append(enabled_roles, 'manager')
where 'member' = any (enabled_roles) and not ('manager' = any (enabled_roles));
update public.company_agent_settings set enabled_roles = array_append(enabled_roles, 'manager')
where 'member' = any (enabled_roles) and not ('manager' = any (enabled_roles));
alter table public.agents alter column enabled_roles set default '{owner,admin,manager,member}';
alter table public.company_agent_settings alter column enabled_roles set default '{owner,admin,manager,member}';
