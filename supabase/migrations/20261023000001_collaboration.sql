-- Step 5: collaboration (CLAUDE.md §4.4): group conversations, history on join, transfers with a
-- Smart Handover, real-time updates and presence. Who Can Help uses only declared expertise
-- (company_members, already readable by colleagues) and shared memory authorship.

-- ─── Real time ───────────────────────────────────────────────────────────────
-- Participants receive new messages and participant changes through Postgres Changes; RLS applies,
-- so each person only receives the messages they may see.
alter publication supabase_realtime add table public.messages, public.conversation_participants;

-- Private channels "conversation:<id>" (presence, typing): only the conversation's participants.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy conversation_channel_read on realtime.messages for select to authenticated
      using (
        realtime.topic() ~ '^conversation:[0-9a-f-]{36}$'
        and private.can_access_conversation(substring(realtime.topic() from 14)::uuid)
      )
    $p$;
    execute $p$
      create policy conversation_channel_write on realtime.messages for insert to authenticated
      with check (
        realtime.topic() ~ '^conversation:[0-9a-f-]{36}$'
        and private.can_access_conversation(substring(realtime.topic() from 14)::uuid)
      )
    $p$;
  else
    raise notice 'realtime.messages missing: presence channels stay closed until Realtime has started';
  end if;
end;
$$;

-- ─── Smart Handover ──────────────────────────────────────────────────────────
-- Prepared by the AI when a conversation or a restricted client is transferred; only the recipient
-- reads and edits it (the sender loses access with the transfer).
create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('conversation', 'client')),
  conversation_id uuid references public.conversations (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  from_user uuid references public.profiles (id) on delete set null,
  to_user uuid not null references public.profiles (id) on delete cascade,
  -- {summary, decisions, documents, tasks, next_actions}: one Markdown text per section.
  sections jsonb not null default '{}',
  ai_generated boolean not null default false,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'conversation') = (conversation_id is not null)),
  check ((kind = 'client') = (client_id is not null))
);
create index handovers_recipient on public.handovers (to_user, created_at desc);

alter table public.handovers enable row level security;
revoke all on public.handovers from anon;
revoke insert, update, delete, truncate, trigger, references on public.handovers from authenticated;
grant update (sections, edited_at) on public.handovers to authenticated;
create policy handovers_select on public.handovers
  for select to authenticated
  using (to_user = (select auth.uid()) and (select private.is_company_member(company_id)));
create policy handovers_update on public.handovers
  for update to authenticated
  using (to_user = (select auth.uid()) and (select private.is_company_member(company_id)))
  with check (to_user = (select auth.uid()));

-- ─── Group conversations ─────────────────────────────────────────────────────
-- Adds colleagues. They see messages from `p_from_seq` on (default: from now). Nobody can share more
-- history than they see themselves; a conversation about a client only takes people with access to it.
create function public.add_conversation_participants(p_conversation uuid, p_users uuid[], p_from_seq integer default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_client uuid;
  v_mine integer;
  v_next integer;
  v_from integer;
  v_user uuid;
begin
  if not private.can_access_conversation(p_conversation) then perform private.fail('not_found'); end if;
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
    values (p_conversation, v_company, v_user, 'participant', v_from, (select auth.uid()))
    on conflict (conversation_id, user_id) do nothing;
    if found then
      perform private.log_event('company', v_company, 'conversation.participant_added', 'conversation', p_conversation::text,
        jsonb_build_object('user_id', v_user, 'history_shared', v_from < v_next));
    end if;
  end loop;
end;
$$;

-- Shares more history with a participant (never more than the caller sees, never less than before).
create function public.share_conversation_history(p_conversation uuid, p_user uuid, p_from_seq integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_mine integer;
  v_theirs integer;
  v_company uuid;
begin
  if not private.can_access_conversation(p_conversation) then perform private.fail('not_found'); end if;
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

-- Leaves a group conversation (the owner transfers it instead).
create function public.leave_conversation(p_conversation uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  if not private.can_access_conversation(p_conversation) then perform private.fail('not_found'); end if;
  if exists (select 1 from public.conversations where id = p_conversation and owner_id = (select auth.uid())) then
    perform private.fail('owner_must_transfer');
  end if;
  delete from public.conversation_participants
  where conversation_id = p_conversation and user_id = (select auth.uid())
  returning company_id into v_company;
  perform private.log_event('company', v_company, 'conversation.participant_left', 'conversation', p_conversation::text, '{}');
end;
$$;

-- ─── Transfers ───────────────────────────────────────────────────────────────
-- The owner gives the conversation to a colleague, who sees its whole history; the sender loses access.
create function public.transfer_conversation(p_conversation uuid, p_to uuid, p_sections jsonb, p_ai_generated boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_client uuid;
  v_handover uuid;
begin
  if not private.can_access_conversation(p_conversation) then perform private.fail('not_found'); end if;
  select company_id, client_id into v_company, v_client from public.conversations
  where id = p_conversation and owner_id = (select auth.uid());
  if v_company is null then perform private.fail('owner_only'); end if;
  if p_to = (select auth.uid()) or not exists (
    select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_to and m.status = 'active'
  ) then
    perform private.fail('not_found');
  end if;
  if v_client is not null and not private.user_has_client_access(v_client, p_to) then perform private.fail('no_client_access'); end if;

  update public.conversations set owner_id = p_to where id = p_conversation;
  insert into public.conversation_participants (conversation_id, company_id, user_id, role, visible_from_seq, added_by)
  values (p_conversation, v_company, p_to, 'owner', 1, (select auth.uid()))
  on conflict (conversation_id, user_id) do update set role = 'owner', visible_from_seq = 1;
  delete from public.conversation_participants where conversation_id = p_conversation and user_id = (select auth.uid());

  insert into public.handovers (company_id, kind, conversation_id, from_user, to_user, sections, ai_generated)
  values (v_company, 'conversation', p_conversation, (select auth.uid()), p_to, coalesce(p_sections, '{}'), coalesce(p_ai_generated, false))
  returning id into v_handover;
  perform private.log_event('company', v_company, 'conversation.transferred', 'conversation', p_conversation::text,
    jsonb_build_object('user_id', p_to));
  return v_handover;
end;
$$;

-- An employee assigned to a restricted client hands it over to a colleague: the assignment moves, the
-- sender's conversations about this client move too (open question 3), and the sender loses access.
create function public.transfer_client(p_client uuid, p_to uuid, p_sections jsonb, p_ai_generated boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_visibility text;
  v_handover uuid;
  v_moved integer := 0;
  v_conv uuid;
begin
  select company_id, visibility::text into v_company, v_visibility from public.clients where id = p_client;
  if v_company is null or not exists (
    select 1 from public.client_assignments a where a.client_id = p_client and a.user_id = (select auth.uid())
  ) then
    perform private.fail('not_found');
  end if;
  if v_visibility <> 'restricted' then perform private.fail('not_restricted'); end if;
  if p_to = (select auth.uid()) or not exists (
    select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_to and m.status = 'active'
  ) then
    perform private.fail('not_found');
  end if;

  insert into public.client_assignments (client_id, company_id, user_id, assigned_by)
  values (p_client, v_company, p_to, (select auth.uid()))
  on conflict do nothing;
  delete from public.client_assignments where client_id = p_client and user_id = (select auth.uid());

  for v_conv in select id from public.conversations where client_id = p_client and owner_id = (select auth.uid()) loop
    update public.conversations set owner_id = p_to where id = v_conv;
    insert into public.conversation_participants (conversation_id, company_id, user_id, role, visible_from_seq, added_by)
    values (v_conv, v_company, p_to, 'owner', 1, (select auth.uid()))
    on conflict (conversation_id, user_id) do update set role = 'owner', visible_from_seq = 1;
    delete from public.conversation_participants where conversation_id = v_conv and user_id = (select auth.uid());
    v_moved := v_moved + 1;
  end loop;

  insert into public.handovers (company_id, kind, client_id, from_user, to_user, sections, ai_generated)
  values (v_company, 'client', p_client, (select auth.uid()), p_to, coalesce(p_sections, '{}'), coalesce(p_ai_generated, false))
  returning id into v_handover;
  perform private.log_event('company', v_company, 'client.transferred', 'client', p_client::text,
    jsonb_build_object('user_id', p_to, 'conversations', v_moved));
  return v_handover;
end;
$$;

-- A group conversation is linked only to a client every participant may access: otherwise those
-- without access would silently lose the conversation (RLS), and the link is refused instead.
create function private.conversation_client_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.client_id is not null and new.client_id is distinct from old.client_id and exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = new.id and not private.user_has_client_access(new.client_id, p.user_id)
  ) then
    perform private.fail('no_client_access');
  end if;
  return new;
end;
$$;
create trigger conversations_client_guard before update of client_id on public.conversations
  for each row execute function private.conversation_client_guard();

-- ─── History on join covers files and sources too ────────────────────────────
-- A participant sees an attachment or a cited source only with its message (visible_from_seq);
-- a file not sent yet is visible to its uploader only.
drop policy attachments_select on public.conversation_attachments;
create policy attachments_select on public.conversation_attachments
  for select to authenticated
  using (
    private.can_access_conversation(conversation_id)
    and (
      (message_id is null and uploaded_by = (select auth.uid()))
      or exists (
        select 1 from public.messages m
        where m.id = message_id and m.seq >= private.visible_from_seq(conversation_id)
      )
    )
  );

drop policy message_sources_select on public.message_sources;
create policy message_sources_select on public.message_sources
  for select to authenticated
  using (
    private.can_access_conversation(conversation_id)
    and space_id is not null
    and private.can_read_space(space_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.seq >= private.visible_from_seq(conversation_id)
    )
  );

-- Stored files follow their attachment row (listing a conversation's folder shows nothing more).
drop policy chat_attachments_select on storage.objects;
create policy chat_attachments_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and private.can_access_conversation(private.try_uuid((storage.foldername(name))[1]))
    and (
      owner_id = (select auth.uid())::text
      or exists (select 1 from public.conversation_attachments a where a.storage_path = objects.name)
    )
  );

-- ─── AI context in group conversations ───────────────────────────────────────
-- Memories every current participant may read: the AI uses only these (intersection of permissions).
create function public.conversation_shared_spaces(p_conversation uuid)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id
  from public.memory_spaces s
  join public.conversations cv on cv.id = p_conversation and cv.company_id = s.company_id
  where private.can_access_conversation(p_conversation)
    and not exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = p_conversation
        and not private.user_space_right(s.id, p.user_id, false)
    );
$$;

revoke execute on function public.add_conversation_participants(uuid, uuid[], integer) from public, anon;
revoke execute on function public.share_conversation_history(uuid, uuid, integer) from public, anon;
revoke execute on function public.leave_conversation(uuid) from public, anon;
revoke execute on function public.transfer_conversation(uuid, uuid, jsonb, boolean) from public, anon;
revoke execute on function public.transfer_client(uuid, uuid, jsonb, boolean) from public, anon;
revoke execute on function public.conversation_shared_spaces(uuid) from public, anon;
grant execute on function public.add_conversation_participants(uuid, uuid[], integer) to authenticated;
grant execute on function public.share_conversation_history(uuid, uuid, integer) to authenticated;
grant execute on function public.leave_conversation(uuid) to authenticated;
grant execute on function public.transfer_conversation(uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.transfer_client(uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.conversation_shared_spaces(uuid) to authenticated;
