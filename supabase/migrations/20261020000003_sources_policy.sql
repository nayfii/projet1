-- A cited source whose memory no longer exists (space_id set to null) is hidden instead of being shown
-- to every participant: Source Proof is visible only to people who can read the source's memory.
drop policy message_sources_select on public.message_sources;
create policy message_sources_select on public.message_sources
  for select to authenticated
  using (
    private.can_access_conversation(conversation_id)
    and space_id is not null
    and private.can_read_space(space_id)
  );
