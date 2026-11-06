-- Chat experience (founder's quick-fix list, November 2026):
-- * Pin and archive a conversation, for oneself only (each participant has their own sidebar).
-- * Edit an earlier prompt and run it again: that message and everything after it are set aside
--   (superseded, like a regenerated answer), with what was learned from them, and the edited prompt
--   is sent as a new message.

alter table public.conversation_participants
  add column pinned_at timestamptz,
  add column archived_at timestamptz;

create function public.set_conversation_pinned(p_conversation uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_participants
     set pinned_at = case when p_pinned then now() else null end
   where conversation_id = p_conversation and user_id = (select auth.uid());
  if not found then perform private.fail('not_found'); end if;
end;
$$;

create function public.set_conversation_archived(p_conversation uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_participants
     set archived_at = case when p_archived then now() else null end,
         pinned_at = case when p_archived then null else pinned_at end
   where conversation_id = p_conversation and user_id = (select auth.uid());
  if not found then perform private.fail('not_found'); end if;
end;
$$;

-- The author edits one of their prompts: it and every later message are set aside. Refused in a
-- conversation where someone else wrote after it (their messages are never hidden by another person),
-- and while an answer is being written.
create function public.rewind_conversation(p_message uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_msg public.messages;
  v_count integer;
begin
  select * into v_msg from public.messages where id = p_message;
  if v_msg.id is null or v_msg.author_type <> 'user' or v_msg.author_id is distinct from (select auth.uid())
     or v_msg.superseded_at is not null or not private.can_post_in_conversation(v_msg.conversation_id) then
    perform private.fail('not_found');
  end if;
  if exists (
    select 1 from public.messages m
    where m.conversation_id = v_msg.conversation_id and m.seq > v_msg.seq and m.superseded_at is null
      and ((m.author_type = 'user' and m.author_id is distinct from (select auth.uid())) or m.status = 'streaming')
  ) then
    perform private.fail('validation');
  end if;
  update public.messages set superseded_at = now()
   where conversation_id = v_msg.conversation_id and seq >= v_msg.seq and superseded_at is null;
  get diagnostics v_count = row_count;
  -- What was learned from the set-aside answers goes with them (previous versions come back).
  delete from public.memory_entries e
   using public.memory_jobs j, public.messages m
   where m.conversation_id = v_msg.conversation_id and m.seq >= v_msg.seq and j.message_id = m.id
     and e.id = any (j.entry_ids) and e.source_type = 'auto' and private.can_write_space(e.space_id);
  update public.memory_jobs j set forgotten_at = now()
    from public.messages m
   where m.conversation_id = v_msg.conversation_id and m.seq >= v_msg.seq and j.message_id = m.id and j.forgotten_at is null;
  return v_count;
end;
$$;

revoke execute on function public.set_conversation_pinned(uuid, boolean), public.set_conversation_archived(uuid, boolean),
  public.rewind_conversation(uuid) from public, anon;
grant execute on function public.set_conversation_pinned(uuid, boolean), public.set_conversation_archived(uuid, boolean),
  public.rewind_conversation(uuid) to authenticated;
