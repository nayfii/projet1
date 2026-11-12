-- Sharing history or transferring a conversation warns about memories cited in the messages that a
-- colleague may not read. With team and project memories (V1.1), the warning names what kind of
-- memory it is and whose (a team or project name), not only a client's name.
drop function public.history_unreadable_sources(uuid, uuid[], integer);
create function public.history_unreadable_sources(p_conversation uuid, p_users uuid[], p_from_seq integer)
returns table (space_id uuid, client_name text, user_id uuid, kind public.memory_kind, owner_name text)
language sql stable security definer set search_path = '' as $$
  select distinct s.space_id, c.name, u.user_id, sp.kind, coalesce(c.name, t.name, pr.name)
  from public.message_sources s
  join public.messages m on m.id = s.message_id
  join public.memory_spaces sp on sp.id = s.space_id
  left join public.clients c on c.id = sp.client_id
  left join public.teams t on t.id = sp.team_id
  left join public.projects pr on pr.id = sp.project_id
  join public.conversations cv on cv.id = s.conversation_id
  cross join unnest(p_users) as u(user_id)
  where s.conversation_id = p_conversation
    and private.can_access_conversation(p_conversation)
    and private.can_read_space(s.space_id)
    and m.superseded_at is null
    and m.seq >= greatest(coalesce(p_from_seq, 1), private.visible_from_seq(p_conversation))
    and exists (select 1 from public.company_members cm where cm.company_id = cv.company_id and cm.user_id = u.user_id and cm.status = 'active')
    and not private.user_space_right(s.space_id, u.user_id, false);
$$;
revoke execute on function public.history_unreadable_sources(uuid, uuid[], integer) from public, anon;
grant execute on function public.history_unreadable_sources(uuid, uuid[], integer) to authenticated;
