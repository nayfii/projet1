-- Automatic conversation titles (founder's request, 2026-11-03): written by the AI after the first
-- answer and updated when the topic changes, like ChatGPT or Claude; a title renamed by hand stays.

alter table public.conversations add column title_auto boolean not null default true;
grant update (title_auto) on public.conversations to authenticated;

-- Written by the app for anyone who can see the conversation, only while its title is automatic.
create function public.set_auto_title(p_conversation uuid, p_title text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_title text := left(regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g'), 120);
begin
  if not private.can_access_conversation(p_conversation) then perform private.fail('not_found'); end if;
  if length(v_title) = 0 then return false; end if;
  update public.conversations set title = v_title where id = p_conversation and title_auto;
  return found;
end;
$$;

-- A small AI task per title, counted like the others.
alter table public.usage_events drop constraint usage_events_feature_check;
alter table public.usage_events add constraint usage_events_feature_check
  check (feature in ('chat', 'memory', 'confronter', 'agent', 'embedding', 'handover', 'router', 'render', 'avatar', 'client_summary', 'dictation', 'title'));

revoke execute on function public.set_auto_title(uuid, text) from public, anon;
grant execute on function public.set_auto_title(uuid, text) to authenticated;
