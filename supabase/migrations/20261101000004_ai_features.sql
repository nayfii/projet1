-- Step 12: company switches for two AI features (CLAUDE.md §11), set by the Owner or an Admin with the "models" scope.
-- * auto_client_memory: the AI adds facts about a client to its memory after answers (with origin and Undo).
-- * dictation_enabled: the microphone in the chat (speech goes to OpenAI's transcription model, unmasked).
create function public.admin_set_ai_features(
  p_company uuid,
  p_auto_client_memory boolean default null,
  p_dictation_enabled boolean default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_admin_scope(p_company, 'models') then perform private.fail('forbidden'); end if;
  insert into public.company_ai_settings (company_id, auto_client_memory, dictation_enabled, updated_by)
  values (p_company, coalesce(p_auto_client_memory, true), coalesce(p_dictation_enabled, true), (select auth.uid()))
  on conflict (company_id) do update set
    auto_client_memory = coalesce(p_auto_client_memory, public.company_ai_settings.auto_client_memory),
    dictation_enabled = coalesce(p_dictation_enabled, public.company_ai_settings.dictation_enabled),
    updated_by = excluded.updated_by;
  perform private.log_event('company', p_company, 'ai.features_updated', 'company', p_company::text,
    jsonb_strip_nulls(jsonb_build_object('auto_client_memory', p_auto_client_memory, 'dictation', p_dictation_enabled)));
end;
$$;

revoke execute on function public.admin_set_ai_features(uuid, boolean, boolean) from public, anon;
grant execute on function public.admin_set_ai_features(uuid, boolean, boolean) to authenticated;

-- Deleting a client for good also removes its documents' files: the function returns their storage paths
-- (once the Owner check has passed) so the server deletes them through the Storage API.
drop function public.delete_client(uuid, text);
create function public.delete_client(p_client uuid, p_confirm_name text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_client public.clients;
  v_paths text[];
begin
  select * into v_client from public.clients where id = p_client;
  if v_client.id is null or not private.is_company_owner(v_client.company_id) then perform private.fail('not_found'); end if;
  if v_client.archived_at is null then perform private.fail('archive_first'); end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(v_client.name)) then perform private.fail('name_mismatch'); end if;
  select coalesce(array_agg(d.storage_path), '{}') into v_paths
  from public.documents d join public.memory_spaces s on s.id = d.space_id
  where s.client_id = p_client;
  delete from public.clients where id = p_client;
  return v_paths;
end;
$$;
revoke execute on function public.delete_client(uuid, text) from public, anon;
grant execute on function public.delete_client(uuid, text) to authenticated;
