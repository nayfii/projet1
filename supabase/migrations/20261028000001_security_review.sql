-- Step 10 security review: fixes found by the review (docs/SECURITY.md §5).

-- ─── Invitations need a confirmed email address ──────────────────────────────
-- With e-mail confirmation off, anyone could create an account for an address they do not own and
-- accept the invitations sent to it. Confirmation is now on (supabase/config.toml), and the database
-- refuses unconfirmed accounts anyway.
create or replace function public.my_pending_invitations()
returns table (invitation_id uuid, company_id uuid, company_name text, role public.company_role, invited_by_name text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.company_id, c.name, i.role, p.full_name, i.expires_at
  from public.invitations i
  join public.companies c on c.id = i.company_id
  left join public.profiles p on p.id = i.invited_by
  where i.email = (select lower(email) from auth.users where id = (select auth.uid()) and email_confirmed_at is not null)
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    and c.status = 'active';
$$;

create or replace function public.accept_invitation(p_invitation uuid default null, p_token text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_inv public.invitations;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  -- Only a confirmed address proves the person owns the mailbox the invitation was sent to.
  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null then perform private.fail('invitation_wrong_email'); end if;

  if p_token is not null then
    select * into v_inv from public.invitations
     where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  else
    select * into v_inv from public.invitations where id = p_invitation;
  end if;

  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    perform private.fail('invitation_invalid');
  end if;
  if v_inv.email <> v_email then perform private.fail('invitation_wrong_email'); end if;
  if not exists (select 1 from public.companies where id = v_inv.company_id and status = 'active') then
    perform private.fail('company_suspended');
  end if;
  if v_inv.role = 'owner' and exists (select 1 from public.company_members where company_id = v_inv.company_id and role = 'owner') then
    perform private.fail('invitation_invalid');
  end if;

  insert into public.company_members (company_id, user_id, role, admin_scopes, job_title, expertise)
  values (v_inv.company_id, v_uid, v_inv.role, v_inv.admin_scopes, v_inv.job_title, v_inv.expertise)
  on conflict (company_id, user_id) do update
    set status = 'active', deactivated_at = null, role = excluded.role, admin_scopes = excluded.admin_scopes;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  update public.profiles set active_company_id = v_inv.company_id where id = v_uid and active_company_id is null;
  perform private.log_event('company', v_inv.company_id, 'invitation.accepted', 'invitation', v_inv.id::text,
    jsonb_build_object('role', v_inv.role));
  return v_inv.company_id;
end;
$$;

-- ─── Handovers: readable only while the recipient still has access ───────────
drop policy handovers_select on public.handovers;
drop policy handovers_update on public.handovers;
create policy handovers_select on public.handovers
  for select to authenticated
  using (
    to_user = (select auth.uid()) and (select private.is_company_member(company_id))
    and case kind when 'client' then private.has_client_access(client_id) else private.can_access_conversation(conversation_id) end
  );
create policy handovers_update on public.handovers
  for update to authenticated
  using (
    to_user = (select auth.uid()) and (select private.is_company_member(company_id))
    and case kind when 'client' then private.has_client_access(client_id) else private.can_access_conversation(conversation_id) end
  )
  with check (to_user = (select auth.uid()));

-- ─── Memory suggestions ──────────────────────────────────────────────────────
-- AI suggestions from a conversation stay private to the person who asked for them until they decide
-- (other writers of the memory could otherwise read what came from a client they cannot access);
-- the proposer sees them only while they can still read the memories involved.
drop policy memory_suggestions_select on public.memory_suggestions;
create policy memory_suggestions_select on public.memory_suggestions
  for select to authenticated
  using (
    (proposed_by = (select auth.uid()) and private.is_company_member(company_id) and private.can_read_space(space_id)
      and (source_space_id is null or private.can_read_space(source_space_id)))
    or (kind = 'promotion' and private.can_write_space(space_id))
    or (kind = 'new_entry' and status <> 'pending' and private.can_write_space(space_id))
  );

create or replace function public.decide_memory_suggestion(p_suggestion uuid, p_approve boolean, p_title text default null, p_content text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.memory_suggestions;
  v_entry uuid;
begin
  select * into v_s from public.memory_suggestions where id = p_suggestion;
  if v_s.id is null or not private.can_write_space(v_s.space_id) then perform private.fail('forbidden'); end if;
  if v_s.status <> 'pending' then perform private.fail('already_decided'); end if;
  -- AI suggestions from a conversation are approved by the person who asked for them (never seen by others before).
  if v_s.kind = 'new_entry' and v_s.proposed_by is distinct from (select auth.uid()) then perform private.fail('forbidden'); end if;
  if not p_approve then
    update public.memory_suggestions set status = 'rejected', decided_by = (select auth.uid()), decided_at = now() where id = v_s.id;
    perform private.log_event('company', v_s.company_id, 'memory.suggestion_rejected', 'memory_space', v_s.space_id::text,
      jsonb_build_object('kind', v_s.kind));
    return null;
  end if;
  insert into public.memory_entries (space_id, title, content, source_type, source_ref, author_id)
  values (
    v_s.space_id,
    coalesce(nullif(trim(p_title), ''), v_s.title),
    coalesce(nullif(trim(p_content), ''), v_s.content),
    case v_s.kind when 'promotion' then 'promotion' else 'ai_suggestion' end,
    v_s.source_ref || jsonb_build_object('suggestion_id', v_s.id, 'proposed_by', v_s.proposed_by),
    (select auth.uid())
  )
  returning id into v_entry;
  update public.memory_suggestions
     set status = 'approved', decided_by = (select auth.uid()), decided_at = now(), entry_id = v_entry
   where id = v_s.id;
  perform private.log_event('company', v_s.company_id, 'memory.suggestion_approved', 'memory_space', v_s.space_id::text,
    jsonb_build_object('kind', v_s.kind));
  return v_entry;
end;
$$;

-- ─── Client transfer: only by an active member who still has access ──────────
create or replace function public.transfer_client(p_client uuid, p_to uuid, p_sections jsonb, p_ai_generated boolean)
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
  -- Still an active member of an active company, with access to the client (a deactivated person keeps
  -- their assignment rows until someone removes them).
  if v_company is null or not private.is_company_member(v_company) or not private.has_client_access(p_client) or not exists (
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

-- ─── Seat limit: also when someone is reactivated or accepts an invitation ───
create function private.check_seat_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_used integer;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then return new; end if;
  select pl.seat_limit into v_limit from public.companies c left join public.plans pl on pl.id = c.plan_id where c.id = new.company_id;
  if v_limit is null then return new; end if;
  select count(*) into v_used from public.company_members
   where company_id = new.company_id and status = 'active' and user_id <> new.user_id;
  if v_used >= v_limit then perform private.fail('seat_limit_reached'); end if;
  return new;
end;
$$;
create trigger company_members_seat_limit before insert or update of status on public.company_members
  for each row execute function private.check_seat_limit();

-- ─── Function rights ─────────────────────────────────────────────────────────
-- Functions in "private" are helpers for policies: no direct use by anonymous callers.
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
-- Earlier blanket grants re-opened these server-only functions: closed again (and after every
-- future "grant execute on all functions", re-run this list).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.hide_assign_placeholders(uuid, jsonb) from authenticated;
revoke execute on function public.render_claim_job(text), public.render_job_progress(uuid, text, numeric, text),
  public.render_job_succeeded(uuid, text, jsonb, numeric), public.render_job_failed(uuid, text, text, boolean)
  from authenticated;

-- ─── Passwords: nobody signs in with one here ────────────────────────────────
-- Someone could create an account with a password for an address before its owner signs in with an
-- e-mail link. At each sign-in the app clears any password (directly, so the session stays open).
create function public.clear_user_password(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  update auth.users set encrypted_password = '' where id = p_user and coalesce(encrypted_password, '') <> '';
$$;
revoke execute on function public.clear_user_password(uuid) from public, anon, authenticated;
grant execute on function public.clear_user_password(uuid) to service_role;
